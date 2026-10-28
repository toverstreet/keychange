import { SoundTouch, SimpleFilter } from 'soundtouchjs'
const SR = 48000, SECONDS = 509
console.log(`benchmark: stretching ${SECONDS}s of ${SR}Hz stereo (${(SECONDS*SR/1e6).toFixed(1)}M frames/ch)`)
const n = SECONDS * SR
const L = new Float32Array(n), R = new Float32Array(n)
for (let i = 0; i < n; i++) { const v = Math.sin(2*Math.PI*220*i/SR)*0.5; L[i]=v; R[i]=v*0.9 }
function src(l, r) { return { extract(t, num, pos) {
  const a = Math.max(0, Math.min(num, l.length - pos))
  for (let i=0;i<a;i++){ t[i*2]=l[pos+i]; t[i*2+1]=r[pos+i] } return a } } }
for (const [label, p] of [['pitch +2', {pitchSemitones:2, speed:1}], ['speed 0.85', {pitchSemitones:0, speed:0.85}]]) {
  const t0 = Date.now()
  const st = new SoundTouch(); st.pitchSemitones = p.pitchSemitones; st.tempo = p.speed
  const f = new SimpleFilter(src(L,R), st)
  const expected = Math.round(n / p.speed)
  const outL = new Float32Array(expected), outR = new Float32Array(expected)
  const CHUNK = 16384, buf = new Float32Array(CHUNK*2)
  let w = 0, got
  while (w < expected && (got = f.extract(buf, CHUNK)) > 0) {
    const take = Math.min(got, expected - w)
    for (let i=0;i<take;i++){ outL[w+i]=buf[i*2]; outR[w+i]=buf[i*2+1] }
    w += take
  }
  console.log(`  ${label.padEnd(11)} ${((Date.now()-t0)/1000).toFixed(2)}s  (${w}/${expected} frames, ${(w/expected*100).toFixed(1)}%)`)
}
