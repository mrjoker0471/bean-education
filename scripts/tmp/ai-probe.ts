import ZAI from 'z-ai-web-dev-sdk'
const zai = await ZAI.create()
try {
  const r = await zai.chat.completions.create({ messages: [{ role: 'user', content: 'Reply with the single word: ok' }], thinking: { type: 'disabled' } })
  console.log('OK:', r.choices[0]?.message?.content?.slice(0, 50))
} catch (e) {
  console.log('PROVIDER ERROR:', e instanceof Error ? e.message.slice(0, 300) : e)
}
