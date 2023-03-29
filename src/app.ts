import { Game, PlayerChats } from '@gathertown/gather-game-client'
import { z } from 'zod'

// require('dotenv').config()

// NPC -> Requires Account (API Key Per Account)
const npcConfigSchema = z.object({
   id: z.string(),
   apiKey: z.string(),
})

const configSchema = z.object({
   NODE_ENV: z.enum(['development', 'test', 'production']),
   NPC_CONFIGS: npcConfigSchema.array(),
   OPEN_AI_API_KEY: z.string(),
   SPACE_ID: z.string(),
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
   const connectResults = npcs.map(g => g.game.connect())
   if (connectResults.some(r => !r)) {
      throw new Error('Failed to configure all NPCs')
   }
   await Promise.all(connectResults)

   // Create chat subscriptions.
   // What are the events we need to listen for?
}

type Npc = {
   id: string
   apiKey: string
   game: Game
}

type PlayerInteractionState = {
   //  playerId: string
   // User or both?
   messages: Message[]
}
type Message =
   | {
        type: 'NPC'
        message: string
     }
   // TODO: can we flatten this?
   | { type: 'PLAYER'; playerChat: PlayerChats }

// TODO:
const runNPC = (npc: Npc): void => {
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

   npc.game.subscribeToEvent('playerChats', ({ playerChats }, context) => {
      // TODO: consider permissions. Can owners eavesdrop?

      // First interaction
      const { senderId } = playerChats
      if (!Object.keys(states).includes(playerChats.senderId)) {
         const newInteraction: PlayerInteractionState = { messages: [{ type: 'PLAYER', playerChat: playerChats }] }
         states.set(senderId, newInteraction)
      }

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const interaction = states.get(senderId)!

      // const reply = getResponseNPC('prompt', interaction.messages.map(m => m.message))
      // do something.
   })

   // handle interact?
   // handle dms
   // Handle player disconnect from room. Delete chat history.
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
