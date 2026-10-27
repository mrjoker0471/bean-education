const DOC = 'cmvq0by8n0000t2vhetsqyqp7'
const GUEST = '246a83ab-358f-4e12-8102-6364a36e75c3'
const post = await fetch(`http://localhost:3000/api/materials/${DOC}/retry`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ guestId: GUEST }), // no force → partial retry
})
console.log('partial retry POST:', post.status, await post.text())
