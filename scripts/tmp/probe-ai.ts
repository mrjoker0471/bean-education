import ZAI from 'z-ai-web-dev-sdk'
async function main() {
  try {
    const zai = await ZAI.create()
    const t0 = Date.now()
    const res = await zai.chat.completions.create({
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      thinking: { type: 'disabled' },
    })
    console.log('PROVIDER OK in', Date.now() - t0, 'ms:', JSON.stringify(res.choices[0]?.message?.content?.slice(0, 50)))
  } catch (err) {
    console.log('PROVIDER ERROR:', err instanceof Error ? err.message.slice(0, 200) : err)
  }
}
main()
