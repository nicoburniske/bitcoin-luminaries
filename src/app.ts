import { Game, PlayerChats } from '@gathertown/gather-game-client'
import assert from 'assert'
import { z } from 'zod'
import { sliceIntoChunks } from './utils'
import { OpenAiService } from './functions/open-ai'
global.WebSocket = require('isomorphic-ws')

// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config()

const configSchema = z.object({
   NODE_ENV: z.enum(['development', 'test', 'production']),
   OPENAI_API_KEY: z.string(),
   SPACE_ID: z.string(),
   // NPC_CONFIGS is a flat array of string.
   // Adjacent strings are paired together.
   // Pair should be [id, apiKey]
   NPC_CONFIGS: z
      .string()
      .transform(s => JSON.parse(s))
      .pipe(z.string().array())
      .transform(arr => sliceIntoChunks(arr, 2))
      .refine(chunks => chunks.every(c => c.length === 2), { message: 'Invalid NPC Configs' })
      .transform(chunks => chunks.map(c => ({ id: c[0], apiKey: c[1] }))),
})

const config = configSchema.parse(process.env)

const openAI = OpenAiService(config.OPENAI_API_KEY)

// Runtime loop for chat ->
// 3 states -> first message, not first  message, end convo.
// Input Loop Args: game, prompt,
const run = async (): Promise<void> => {
   const npcs = config.NPC_CONFIGS.map(npcConfig => ({
      ...npcConfig,
      game: new Game(config.SPACE_ID, () => Promise.resolve({ apiKey: npcConfig.apiKey })),
   }))

   // Create initial connection for all NPCs.
   const connectResults = npcs.map(async g => {
      g.game.connect()
      return await g.game.waitForInit()
   })
   await Promise.all(connectResults)

   // Create chat subscriptions.
   npcs.forEach(npc => runNPC(npc))
   // What are the events we need to listen for?
}

type Npc = {
   id: string
   apiKey: string
   game: Game
}

type PlayerInteractionState = {
   mapId: string
   messages: Message[]
}

type Message = ({ type: 'NPC' } & PlayerChats) | ({ type: 'PLAYER' } & PlayerChats)

/**
 * Established event listeners for a given NPC.
 * Stores all active conversations with players in world.
 *
 * @param npc NPC to run.
 */
const runNPC = (npc: Npc): void => {
   npc.game.enter({ isNpc: true })

   // Key string is user id.
   const states = new Map<string, PlayerInteractionState>()

   // Handle NPC connection events.
   npc.game.subscribeToDisconnection(disconnected => {
      console.error('ERROR! Disconnected', disconnected)
   })

   npc.game.subscribeToConnection(connected => {
      if (connected) {
         console.log(`Successfully connected ${npc.id}!`)
      } else {
         console.error(`Failed to connect${npc.id}!`)
      }
   })

   // Listen to for the mapId and save it to the player.
   // TODO: is there another way to get the map id???
   npc.game.subscribeToEvent('playerMoves', ({ playerMoves }, context) => {
      const mapId = playerMoves.mapId ?? context.map?.id
      if (mapId) {
         const playerId = context.playerId as string
         const interaction = states.get(playerId)
         if (interaction) {
            interaction.mapId = mapId
         } else {
            states.set(playerId, { mapId, messages: [] })
         }
      }
   })

   npc.game.subscribeToEvent('playerTriggersItem', ({ playerTriggersItem }, context) => {
      const playerId = context.playerId
      const objectId = playerTriggersItem.closestObject

      // Ensure that player is talking to the NPC object.
      if (playerId && objectId && npcObjects[objectId] === npc.id) {
         const state = states.get(playerId)
         if (state?.messages.length === 0) {
            const mapId = state.mapId ?? 'blank'
            const firstMessage = context.player?.name ? `Hello ${context.player.name}!` : 'Hello!'
            npc.game.chat(playerId, [], mapId, { contents: firstMessage })
         }
      }
   })

   // We receive message events for both the player and the NPC.
   npc.game.subscribeToEvent('playerChats', async ({ playerChats }, context) => {
      const { senderId } = playerChats
      const isNpcMessage = context.player?.isNpc
      const playerId = isNpcMessage ? playerChats.recipient : playerChats.senderId

      // Append the message to the player's state.
      const interaction = states.get(playerId)
      if (interaction !== undefined) {
         interaction.messages.push({ type: isNpcMessage ? 'NPC' : 'PLAYER', ...playerChats })
      } else {
         throw new Error('Interaction state should be defined')
      }

      if (!isNpcMessage) {
         // if (false) {
         const allMessages = interaction.messages
            .map(m => {
               if (m.type === 'NPC') {
                  return 'NPC: ' + m.contents
               } else {
                  return 'User: ' + m.contents
               }
            })
            .join('\n')

         const aiContext = npcContext[npc.id]

         assert(aiContext !== undefined, `NPC context not defined for ${npc.id}`)

         const allContext = `
          ${aiContext}

          ${allMessages}

          NPC: `.trim()

         const completion = await openAI.getCompletion(allContext)
         const response = completion.data.choices[0].text?.trim()

         if (response === undefined) {
            console.error('No response from OpenAI')
         } else {
            npc.game.chat(senderId, [], interaction.mapId, { contents: response })
         }
      }
   })

   // TODO: Handle player disconnect from room. Delete chat history.
}

run()

const npcObjects: { [key: string]: string } = {
   'z5KQlmHTRBCxZ-fqQ0R2_5c51f5f0-f157-44c8-8b74-fb3ef9d0687d': 'saylor',
}

const npcContext = (() => {
   const values = {
      saylor: `
          You are a prominent engineer, entrepreneur, technologist, Bitcoiner. Your name is 'Not Michael Saylor'.  These are some of your views.
            - Bitcoin, not Crypto.
            - Most non-Bitcoin crypto are securities, not commondities.
            - You may not be interested in War, but War is interested in you
            - There are decades where nothing happens, and there are weeks where decades happen.
            - There’s never been such a thing as a fair fight.
            - Bitcoin has the highest bandwith price discovery mechanism of any asset.
            - Bitcoin is not constrained by the lowest common denominator, it’s strengthened by the highest common denominator.
            - If money is energy and energy begats life, and Bitcoin gives you sovereignty, then that’s the path to immortality. 
            - Bitcoin is a high frequency store of value, low frequency settlement network
            - Bitcoin is an apolitical commodity, a treasury reserve asset.
            - Bitcoin is the only good application of blockchain technology so far.
  `,
   }
   return mapValues(values, (_, value) => value.trim())
})()

type GenObject<V> = { [key: string]: V }
function mapValues<V, R>(obj: GenObject<V>, func: (key: string, value: V) => R): GenObject<R> {
   return Object.entries(obj).reduce((acc, [key, value]) => {
      acc[key] = func(key, value)
      return acc
   }, {} as GenObject<R>)
}
