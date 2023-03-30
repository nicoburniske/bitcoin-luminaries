import { Game, PlayerChats } from '@gathertown/gather-game-client'
import assert from 'assert'
import { z } from 'zod'
import { sliceIntoChunks } from './utils'
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
   mapId: string | undefined
   messages: Message[]
}
type Message =
   | {
        type: 'NPC'
        message: string
     }
   // TODO: can we flatten this?
   | ({ type: 'PLAYER' } & PlayerChats)

const runNPC = (npc: Npc): void => {
   npc.game.enter({ isNpc: true })

   // Key string is user id.
   const states = new Map<string, PlayerInteractionState>()

   // Handle NPC disconnection.
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

   npc.game.subscribeToEvent('playerMoves', ({ playerMoves }, context) => {
      // Listen to for the mapId and save it to the player
      if (playerMoves.mapId) {
         const playerId = context.playerId as string
         const mapId = playerMoves.mapId
         const interaction = states.get(playerId)
         if (interaction) {
            interaction.mapId = mapId
         } else {
            states.set(playerId, { mapId, messages: [] })
         }
      }
   })

   const npcToInteractableObject: { [key: string]: string } = {
      'HologramAvatar - e86LVs7JpcL3lbuK85oz_162ad252-6ce1-4410-8a8c-90436562252e': 'saylor',
   }

   npc.game.subscribeToEvent('playerTriggersItem', ({ playerTriggersItem }, context) => {
      const playerId = context.playerId as string

      // TODO: Update assertions to return if not met.
      const objectId = playerTriggersItem.closestObject
      assert(objectId, 'No closest object')

      console.log('objectId', objectId)

      const npcId = npcToInteractableObject[objectId]

      const mapId = states.get(playerId)?.mapId ?? 'blank'

      npc.game.chat(playerId, [], mapId, { contents: `Hello ${context.player?.name}!` })
   })

   npc.game.subscribeToEvent('playerChats', ({ playerChats }, context) => {
      // TODO: consider permissions. Can owners eavesdrop?

      // First interaction
      const { senderId } = playerChats

      // Append the message to the player's state.
      const interaction = states.get(senderId)
      if (interaction) {
         interaction.messages.push({ type: 'PLAYER', ...playerChats })
      } else {
         throw new Error('Interaction state should be defined')
      }

      // const reply = getResponseNPC('prompt', interaction.messages.map(m => m.message))
      // do something.
   })

   // TODO: Handle player disconnect from room. Delete chat history.
}

// TODO: Connect to OpenAI
const getResponseNPC = async (prompt: string, messages: string[]): Promise<string> => {
   return 'reply!'
}

// game.subscribeToConnection((connected) => console.log("connected?", connected));

// /**** the good stuff ****/

// game.subscribeToEvent("playerMoves", (data, context) => {
//   console.log(
//     context?.player?.name ?? context.playerId,
//     "moved in direction",
//     data.playerMoves.direction
//   );
// });

run()
