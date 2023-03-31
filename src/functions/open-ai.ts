import { Configuration, OpenAIApi } from 'openai'

export const OpenAiService = (apiKey: string) => {
   const config = new Configuration({ apiKey })
   const openai = new OpenAIApi(config)

   const getCompletion = async (prompt: string) =>
      openai.createCompletion({
         model: 'text-davinci-003',
         temperature: 0.5,
         max_tokens: 500,
         prompt,
      })

   //    const getChatResponse = async (prompt: string) => openai.createChatCompletion({})

   return {
      getCompletion,
   }
}
