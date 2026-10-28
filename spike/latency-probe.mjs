import { SoundTouch, SimpleFilter } from 'soundtouchjs'
const SR = 48000
function makeSource(mono) {
  return { extract(t, n, p) {
    const a = Math.max(0, Math.min(n, mono.length - p))
    for (let i = 0; i < a; i++) { const s = mono[p + i]; t[i*2] = s; t[i*2+1] = s }
    return a
  } }
}
function sine(f, sec) { const o = new Float32Array(Math.floor(sec*SR)); for (let i=0;i<o.length;i++) o[i]=Math.sin(2*Math.PI*f*i/SR); return o }
function run(mono, { pitchSemitones = 0, speed = 1 }) {
  const st = new SoundTouch(); st.pitchSemitones = pitchSemitones; st.tempo = speed
  const f = new SimpleFilter(makeSource(mono), st)
  const CHUNK = 4096, buf = new Float32Array(CHUNK*2), out = []
  let n, guard = 1e6
  while ((n = f.extract(buf, CHUNK)) > 0 && guard-- > 0) for (let i=0;i<n;i++) out.push(buf[i*2])
  return out.length
}
console.log('fixed-latency hypothesis: deficit should stay constant as input grows\n')
for (const sec of [1, 2, 4, 8]) {
  const input = sine(440, sec)
  for (const [label, p] of [['pitch+2', {pitchSemitones:2}], ['speed1.5', {speed:1.5}], ['speed0.85', {speed:0.85}]]) {
    const got = run(input, p)
    const expected = Math.round(input.length / (p.speed ?? 1))
    const deficit = expected - got
    console.log(`${sec}s ${label.padEnd(9)} expected ${expected} got ${got} deficit ${deficit} (${(deficit/SR*1000).toFixed(1)} ms)`)
  }
  console.log('')
}
