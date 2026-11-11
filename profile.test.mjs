import assert from 'node:assert/strict'
import { streaks, bar } from './profile.mjs'

const d = (date, c) => ({ date, contributionCount: c })
const days = [d('01', 1), d('02', 1), d('03', 1), d('04', 0), d('05', 2), d('06', 3), d('07', 0)]
assert.deepEqual(streaks(days, '07'), { current: 2, longest: 3 }) // empty today doesn't break the streak
assert.deepEqual(streaks(days, '08'), { current: 0, longest: 3 })
assert.equal(bar(1, 4), '████')
assert.equal(bar(0.5, 3), '█▌')
assert.equal(bar(0.001, 10), '▏') // nonzero never renders empty
assert.equal(bar(0, 10), '')
console.log('ok')
