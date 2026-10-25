// Test: ZAI SDK JSON-mode behaviour + latency for Riishe pipeline design
import ZAI from 'z-ai-web-dev-sdk'

const t0 = Date.now()
const zai = await ZAI.create()
console.log('ZAI.create:', Date.now() - t0, 'ms')

const t1 = Date.now()
const res = await zai.chat.completions.create({
  messages: [
    { role: 'assistant', content: 'You are a strict JSON API. Reply with ONLY a valid JSON object, no markdown fences, no commentary.' },
    { role: 'user', content: 'Extract topics from this study text and return JSON: {"topics":[{"name":string,"subtopics":string[],"pages":number[]}],"summary":string}. TEXT: Photosynthesis converts light to chemical energy. Chlorophyll absorbs blue and red light. The Calvin cycle fixes CO2 into glucose using ATP and NADPH. (pages 1-3)' },
  ],
  thinking: { type: 'disabled' },
})
const txt = res.choices[0]?.message?.content ?? ''
console.log('latency:', Date.now() - t1, 'ms')
console.log('RAW:', JSON.stringify(txt.slice(0, 400)))
try {
  const parsed = JSON.parse(txt)
  console.log('PLAIN JSON.parse: OK, topics =', parsed.topics?.map(t => t.name))
} catch {
  console.log('PLAIN JSON.parse: FAILED — need tolerant extraction')
}
