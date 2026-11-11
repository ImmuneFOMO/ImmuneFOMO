// Renders ascii-dark.svg / ascii-light.svg from the GitHub GraphQL API. Zero deps.
//   node profile.mjs                    render the SVGs with CONFIG below
//   node profile.mjs --studio [file]    studio.html: pick design, sections, colors; paste the CONFIG it gives back here

export const CONFIG = {
  design: 'fetch', // dashboard | fetch | receipt
  sections: ['heatmap', 'year', 'languages', 'building', 'punchcard'],
  colors: {
    dark: { bg: '#0a0a0a', ink: '#ededed', dim: '#8a8a8a', faint: '#2a2a2a', acc: '#ffffff' },
    light: { bg: '#ffffff', ink: '#111111', dim: '#6b6b6b', faint: '#dddddd', acc: '#000000' },
  },
}

export const SECTIONS = {
  heatmap: 'contribution map', year: 'last 365 days', languages: 'languages', building: 'now building',
  punchcard: 'when i code', rhythm: 'weekly rhythm', recent: 'recently pushed', repos: 'commits by repo',
}
export const DESIGNS = ['dashboard', 'fetch', 'receipt']

const env = globalThis.process?.env || {}
const LOGIN = env.LOGIN || 'ImmuneFOMO'
const TZ = 'Europe/Lisbon'
const FS = 12, CW = 7.2, LH = 16, PAD = 16 // CW = 0.6em, the advance of any monospace font
const RAMP = '.:-=+*#%@' // tone → glyph, sparse to dense
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// own 6-row pixel font, one column = one pixel; strokes are 2 wide so pixels read square
const FONT = {
  I: ['##', '##', '##', '##', '##', '##'],
  M: ['###    ###', '####  ####', '## #### ##', '##  ##  ##', '##      ##', '##      ##'],
  U: ['##    ##', '##    ##', '##    ##', '##    ##', '##    ##', ' ###### '],
  N: ['###    ##', '####   ##', '## ##  ##', '##  ## ##', '##   ####', '##    ###'],
  E: ['#######', '##     ', '#####  ', '##     ', '##     ', '#######'],
  F: ['#######', '##     ', '#####  ', '##     ', '##     ', '##     '],
  O: [' ###### ', '##    ##', '##    ##', '##    ##', '##    ##', ' ###### '],
}
const BANNER = FONT.I.map((_, y) => [...'IMMUNEFOMO'].map(c => FONT[c][y]).join(' '))

async function gql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { authorization: `bearer ${env.GH_TOKEN}`, 'user-agent': 'ascii-profile' },
    body: JSON.stringify({ query, variables }),
  })
  const json = await res.json()
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors || json))
  return json.data
}

async function fetchData() {
  const since = new Date(Date.now() - 365 * 864e5).toISOString()
  const { user } = await gql(`query($login:String!){ user(login:$login){
    id login location createdAt followers{totalCount} following{totalCount}
    pullRequests(states:MERGED){totalCount}
    contributionsCollection{
      totalCommitContributions restrictedContributionsCount totalPullRequestContributions
      totalPullRequestReviewContributions totalIssueContributions totalRepositoriesWithContributedCommits
      contributionCalendar{ totalContributions weeks{ contributionDays{ date contributionCount weekday } } }
      commitContributionsByRepository(maxRepositories:25){
        repository{ name owner{login} isPrivate pushedAt primaryLanguage{name} }
        contributions(first:100, orderBy:{field:OCCURRED_AT, direction:DESC}){ nodes{ occurredAt commitCount } }
      }
    }
  }}`, { login: LOGIN })

  const repos = []
  for (let after = null; ;) {
    const { user: { repositories: r } } = await gql(`query($login:String!,$after:String){ user(login:$login){
      repositories(first:100, after:$after, ownerAffiliations:OWNER, isFork:false, orderBy:{field:PUSHED_AT,direction:DESC}){
        pageInfo{hasNextPage endCursor}
        nodes{ name isPrivate isArchived pushedAt stargazerCount primaryLanguage{name}
          languages(first:15, orderBy:{field:SIZE,direction:DESC}){ edges{ size node{name} } } }
      }}}`, { login: LOGIN, after })
    repos.push(...r.nodes)
    if (!r.pageInfo.hasNextPage) break
    after = r.pageInfo.endCursor
  }

  // commit hours only exist on commits, so walk default-branch history of repos touched this year
  const hours = DAYS.map(() => Array(24).fill(0))
  const local = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: 'numeric', hourCycle: 'h23' })
  const byRepo = user.contributionsCollection.commitContributionsByRepository
  for (const { repository: r } of byRepo) {
    for (let after = null; ;) {
      const { repository } = await gql(`query($o:String!,$n:String!,$id:ID!,$since:GitTimestamp!,$after:String){
        repository(owner:$o,name:$n){ defaultBranchRef{ target{ ... on Commit{
          history(first:100, after:$after, since:$since, author:{id:$id}){ pageInfo{hasNextPage endCursor} nodes{ authoredDate } }
        }}}}}`, { o: r.owner.login, n: r.name, id: user.id, since, after })
      const h = repository?.defaultBranchRef?.target?.history
      if (!h) break
      for (const c of h.nodes) {
        const p = Object.fromEntries(local.formatToParts(new Date(c.authoredDate)).map(x => [x.type, x.value]))
        hours[DAYS.indexOf(p.weekday)][+p.hour % 24]++
      }
      if (!h.pageInfo.hasNextPage) break
      after = h.pageInfo.endCursor
    }
  }

  // private names never leave this function
  delete user.contributionsCollection.commitContributionsByRepository
  delete user.id
  return {
    at: new Date().toISOString(), user, hours,
    repos: repos.map(r => ({ ...r, name: r.isPrivate ? null : r.name })),
    byRepo: byRepo.map(({ repository: r, contributions: c }) => ({
      name: r.isPrivate ? null : r.name, lang: r.primaryLanguage?.name, pushedAt: r.pushedAt, days: c.nodes,
    })),
  }
}

export function streaks(days, today) {
  let longest = 0, run = 0
  for (const d of days) longest = Math.max(longest, (run = d.contributionCount ? run + 1 : 0))
  let i = days.length - 1, current = 0
  if (days[i]?.date === today && !days[i].contributionCount) i-- // today isn't over yet
  for (; i >= 0 && days[i].contributionCount; i--) current++
  return { current, longest }
}

export function bar(frac, width) {
  const eighths = Math.round(Math.max(0, Math.min(1, frac)) * width * 8)
  const s = '█'.repeat(eighths >> 3) + (eighths & 7 ? ' ▏▎▍▌▋▊▉'[eighths & 7] : '')
  return frac > 0 && !s ? '▏' : s
}

const fmt = n => n.toLocaleString('en-US')
const ago = (iso, now) => {
  const d = Math.floor((now - new Date(iso)) / 864e5)
  return d < 1 ? 'today' : d < 30 ? `${d}d` : d < 365 ? `${Math.floor(d / 30)}mo` : `${Math.floor(d / 365)}y`
}
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const HIDDEN = '▒▒▒▒▒▒▒▒'
const spark = (vals, max) => vals.map(n => (n ? '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor(Math.sqrt(n / max) * 8))] : ' ')).join('')
const tone = (n, max) => {
  if (!n) return ['·', 'g0']
  const t = Math.min(1, n / max)
  return [RAMP[Math.min(8, Math.floor(t * 9))], `g${1 + Math.min(3, Math.floor(t * 4))}`]
}

// A line is a list of [text, class] segments; layout helpers work on those.
const len = line => line.reduce((n, [t]) => n + [...t].length, 0)
const padLine = (line, w) => [...line, [' '.repeat(Math.max(0, w - len(line))), '']]
const between = (left, right, w) => [...left, [' '.repeat(Math.max(1, w - len(left) - len(right))), ''], ...right]
const center = (line, w) => [[' '.repeat(Math.max(0, (w - len(line)) >> 1)), ''], ...line]

function box(title, lines, width, height = lines.length) {
  const top = [['╭─ ', 'faint'], [title, 'acc'], [' ' + '─'.repeat(width - [...title].length - 5) + '╮', 'faint']]
  const body = Array.from({ length: height }, (_, i) => [['│ ', 'faint'], ...padLine(lines[i] || [], width - 4), [' │', 'faint']])
  return [top, ...body, [['╰' + '─'.repeat(width - 2) + '╯', 'faint']]]
}

function stats(data, now) {
  const { user, repos } = data
  const cc = user.contributionsCollection
  const days = cc.contributionCalendar.weeks.flatMap(w => w.contributionDays)
  const counts = days.map(d => d.contributionCount).filter(Boolean).sort((a, b) => a - b)
  const langs = new Map()
  for (const r of repos) for (const e of r.languages.edges) langs.set(e.node.name, (langs.get(e.node.name) || 0) + e.size)
  const weeks = cc.contributionCalendar.weeks.slice(-53)
  const byDay = DAYS.map((_, wd) => days.filter(d => d.weekday === wd).reduce((n, d) => n + d.contributionCount, 0))
  const repoCommits = data.byRepo.map(r => r.days.reduce((n, d) => n + d.commitCount, 0))
  const privCommits = data.byRepo.reduce((n, r, i) => n + (r.name ? 0 : repoCommits[i]), 0)
  return {
    ...data, cc, days, weeks, now, byDay, repoCommits,
    ...streaks(days, now.toISOString().slice(0, 10)),
    p90: counts[Math.floor(counts.length * 0.9)] || 1, // clip outliers so one huge day doesn't flatten the map
    best: days.reduce((a, d) => (d.contributionCount > a.contributionCount ? d : a), days[0]),
    commits: cc.totalCommitContributions + cc.restrictedContributionsCount,
    years: ((now - new Date(user.createdAt)) / 3.156e10).toFixed(1),
    stars: repos.reduce((n, r) => n + r.stargazerCount, 0),
    pub: repos.filter(r => !r.isPrivate),
    langs: [...langs].sort((a, b) => b[1] - a[1]),
    langTotal: [...langs.values()].reduce((a, b) => a + b, 0) || 1,
    weekly: weeks.map(w => w.contributionDays.reduce((n, d) => n + d.contributionCount, 0)),
    privShare: Math.round((privCommits / (repoCommits.reduce((a, b) => a + b, 0) || 1)) * 100),
    peakDay: byDay.indexOf(Math.max(...byDay)),
  }
}

// Blocks: (stats, inner width) → [title, lines]. Every block adapts to the width it's given.
const BLOCKS = {
  heatmap(s, w) {
    const cell = w >= 110 ? 2 : 1
    let month = -1, head = '     '
    s.weeks.forEach((wk, x) => {
      const m = +wk.contributionDays[0].date.slice(5, 7) - 1
      if (m !== month && x < s.weeks.length - 2 && head.length <= 5 + x * cell) head = head.padEnd(5 + x * cell) + MONTHS[m]
      month = m
    })
    const lines = [[[head, 'dim']]]
    for (let wd = 0; wd < 7; wd++) {
      const line = [[wd % 2 ? DAYS[wd] + '  ' : '     ', 'dim']]
      s.weeks.forEach((wk, x) => {
        const d = wk.contributionDays.find(d => d.weekday === wd)
        if (!d) return line.push([' '.repeat(cell), ''])
        const [g, c] = tone(d.contributionCount, s.p90)
        line.push([g, `${c} w${x}`], [' '.repeat(cell - 1), ''])
      })
      lines.push(line)
    }
    const legend = [['less ', 'dim'], ['· ', 'g0'], [': ', 'g1'], ['= ', 'g2'], ['* ', 'g3'], ['@', 'g4'], [' more', 'dim']]
    const streak = [['streak ', 'dim'], [`${s.current}d`, 'acc'], ['  longest ', 'dim'], [`${s.longest}d`, 'ink'],
      ['  best ', 'dim'], [`${s.best.contributionCount} on ${s.best.date.slice(5)}`, 'ink']]
    lines.push([])
    if (w >= 80) lines.push(between(legend, streak, w))
    else lines.push(legend, streak)
    return [`contributions · ${fmt(s.cc.contributionCalendar.totalContributions)} in the last year`, lines]
  },

  year(s, w) {
    const rows = [['commits', s.commits], ['pull requests', s.cc.totalPullRequestContributions],
      ['code reviews', s.cc.totalPullRequestReviewContributions], ['issues', s.cc.totalIssueContributions]]
    const max = Math.max(...rows.map(r => r[1]), 1)
    const wk = s.weekly.slice(-w)
    return ['last 365 days', [
      ...rows.map(([k, v]) => [[k.padEnd(14), 'dim'], [fmt(v).padStart(6) + '  ', 'ink'], [bar(v / max, w - 22), 'acc']]),
      [['repos touched', 'dim'], [String(s.cc.totalRepositoriesWithContributedCommits).padStart(7), 'ink'],
       ['  merged PRs ever ', 'dim'], [fmt(s.user.pullRequests.totalCount), 'ink']],
      [['private work ', 'dim'], [`${s.privShare}%`.padStart(8), 'ink'], ['  of commits', 'dim']],
      [],
      [[spark(wk, Math.max(...wk, 1)), 'acc']],
      between([[`${wk.length}w ago`, 'faint'], [' contributions per week', 'dim']], [['now', 'faint']], wk.length),
    ]]
  },

  languages(s, w) {
    const top = s.langs.slice(0, 8)
    return ['languages · by bytes', top.map(([name, size], i) => [
      [trunc(name, 13).padEnd(14), i ? 'ink' : 'acc'],
      [bar(size / top[0][1], w - 22).padEnd(w - 21), `g${4 - Math.min(3, i >> 1)}`],
      [((size / s.langTotal) * 100).toFixed(1).padStart(6) + '%', 'dim'],
    ])]
  },

  building(s, w) {
    const day0 = s.now - 84 * 864e5
    const rows = s.byRepo.map((r, i) => {
      const weeks = Array(12).fill(0)
      for (const d of r.days) {
        const k = Math.floor((new Date(d.occurredAt) - day0) / (7 * 864e5))
        if (k >= 0 && k < 12) weeks[k] += d.commitCount
      }
      return { ...r, weeks, n: weeks.reduce((a, b) => a + b, 0), last: r.days[0]?.occurredAt }
    }).filter(r => r.n).sort((a, b) => b.last.localeCompare(a.last)).slice(0, 7)
    const max = Math.max(...rows.flatMap(r => r.weeks), 1)
    const nw = w - 32
    return ['now building · 12 weeks', [
      ...rows.map(r => [
        ['▸ ', 'acc'], [trunc(r.name || HIDDEN, nw - 1).padEnd(nw), r.name ? 'ink' : 'faint'],
        [trunc(r.lang || '—', 5).padEnd(6), 'dim'], [spark(r.weeks, max), 'acc'],
        [String(r.n).padStart(5), 'ink'], [ago(r.last, s.now).padStart(7), 'dim'],
      ]),
      [],
      [[' '.repeat(nw + 8), ''], ['12w ago', 'faint'], ['  ', ''], ['now', 'faint']],
    ]]
  },

  punchcard(s, w) {
    const total = s.hours.flat().reduce((a, b) => a + b, 0)
    if (!total) return ['when i code', [[['no commit history yet', 'dim']]]]
    const max = [...s.hours.flat()].sort((a, b) => a - b)[Math.floor(168 * 0.95)] || 1
    const cell = w >= 52 ? 2 : 1
    const head = [0, 3, 6, 9, 12, 15, 18, 21].map(h => String(h).padEnd(3 * cell)).join('')
    const lines = [[['    ', ''], [head.trimEnd(), 'dim']]]
    let peak = [0, 0]
    for (const wd of [1, 2, 3, 4, 5, 6, 0]) {
      const line = [[DAYS[wd] + ' ', 'dim']]
      s.hours[wd].forEach((n, h) => {
        if (n > s.hours[peak[0]][peak[1]]) peak = [wd, h]
        line.push(tone(n, max), [' '.repeat(cell - 1), ''])
      })
      lines.push(line)
    }
    const night = s.hours.reduce((a, d) => a + d.slice(20).reduce((x, y) => x + y, 0) + d.slice(0, 5).reduce((x, y) => x + y, 0), 0)
    lines.push([], [['peak ', 'dim'], [`${DAYS[peak[0]]} ${peak[1]}h`, 'acc'], ['  after dark ', 'dim'],
      [`${Math.round((night / total) * 100)}%`, 'ink'], ['  of ', 'dim'], [fmt(total), 'ink'], [' commits', 'dim']])
    return ['when i code · lisbon time', lines]
  },

  rhythm(s, w) {
    const max = Math.max(...s.byDay, 1)
    return ['weekly rhythm', [1, 2, 3, 4, 5, 6, 0].map(wd => [
      [DAYS[wd] + ' ', wd === s.peakDay ? 'acc' : 'dim'],
      [bar(s.byDay[wd] / max, w - 11).padEnd(w - 10), wd === s.peakDay ? 'g4' : 'g2'],
      [fmt(s.byDay[wd]).padStart(6), 'dim'],
    ])]
  },

  recent(s, w) {
    const nw = w - 25
    return ['recently pushed', s.pub.filter(r => !r.isArchived && r.name !== LOGIN).slice(0, 7).map(r => [
      ['▸ ', 'acc'], [trunc(r.name, nw - 1).padEnd(nw), 'ink'],
      [trunc(r.primaryLanguage?.name || '—', 10).padEnd(11), 'dim'],
      [(r.stargazerCount ? '★' + r.stargazerCount : '').padEnd(5), 'acc'], [ago(r.pushedAt, s.now).padStart(5), 'dim'],
    ])]
  },

  repos(s, w) {
    const rows = s.byRepo.map((r, i) => ({ ...r, n: s.repoCommits[i] })).sort((a, b) => b.n - a.n).slice(0, 7)
    return ['commits by repo · 365d', rows.map(r => [
      [trunc(r.name || HIDDEN, 12).padEnd(13), r.name ? 'ink' : 'faint'], [trunc(r.lang || '—', 5).padEnd(6), 'dim'],
      [bar(r.n / rows[0].n, w - 25).padEnd(w - 24), 'acc'], [fmt(r.n).padStart(5), 'dim'],
    ])]
  },
}
const WIDE = new Set(['heatmap'])

// lays sections out: wide ones alone, the rest in pairs; a leftover half block goes full width
function flow(ids, full, pair) {
  const out = []
  let q = null
  for (const id of ids.filter(id => BLOCKS[id])) {
    if (WIDE.has(id)) { if (q) out.push(...full(q)), (q = null); out.push(...full(id)) }
    else if (q) out.push(...pair(q, id)), (q = null)
    else q = id
  }
  if (q) out.push(...full(q))
  return out
}

const prompt = (s, cols, cmd = '') => between(
  [['  ' + LOGIN.toLowerCase() + '@github', 'acc'], [':', 'dim'], ['~', 'ink'], ['$ ', 'dim'], [cmd, 'ink'], ['█', 'acc cursor']],
  [[`updated ${new Date(s.at).toISOString().slice(0, 16).replace('T', ' ')} UTC  `, 'faint']], cols)

const LAYOUTS = {
  dashboard(s, cfg) {
    const C = 114, L = 56, R = C - L - 1
    const who = [
      [['@' + s.user.login, 'ink']], [],
      [['loc   ', 'dim'], [s.user.location || '—', 'ink']],
      [['since ', 'dim'], [`${s.user.createdAt.slice(0, 4)} · ${s.years}y`, 'ink']],
      [['repos ', 'dim'], [`${s.pub.length} pub · ${s.repos.length - s.pub.length} priv`, 'ink']],
      [['net   ', 'dim'], [`${s.user.followers.totalCount}↓ ${s.user.following.totalCount}↑ ★${s.stars}`, 'ink']],
    ]
    // banner itself is drawn as rects in svg(); these rows only carry the whoami column
    const out = BANNER.map((_, i) => [[' '.repeat(92), ''], ...who[i]])
    out.push([])
    out.push(...flow(cfg.sections,
      id => box(...BLOCKS[id](s, C - 4), C),
      (a, b) => {
        const [x, y] = [BLOCKS[a](s, L - 4), BLOCKS[b](s, R - 4)]
        const h = Math.max(x[1].length, y[1].length)
        const bx = box(...x, L, h), by = box(...y, R, h)
        return bx.map((l, i) => [...l, [' ', ''], ...by[i]])
      }))
    out.push([], prompt(s, C))
    return { cols: C, lines: out, banner: true }
  },

  fetch(s, cfg) {
    const C = 114, H = 55
    const kv = (k, v) => [[k.padEnd(11), 'acc'], [v, 'ink']]
    const info = [
      [[s.user.login.toLowerCase(), 'acc'], ['@', 'dim'], ['github', 'acc']],
      [['─'.repeat(s.user.login.length + 7), 'faint']],
      kv('location', s.user.location || '—'),
      kv('joined', `${s.user.createdAt.slice(0, 4)} (${s.years}y ago)`),
      kv('repos', `${s.pub.length} public · ${s.repos.length - s.pub.length} private`),
      kv('network', `${s.user.followers.totalCount} followers · ${s.user.following.totalCount} following`),
      kv('stars', `★ ${s.stars}`),
      kv('commits', `${fmt(s.commits)} this year · ${s.privShare}% private`),
      kv('streak', `${s.current}d now · ${s.longest}d best`),
      kv('top lang', s.langs.slice(0, 3).map(([n, b]) => `${n} ${Math.round((b / s.langTotal) * 100)}%`).join(' · ')),
      kv('merged PRs', `${fmt(s.user.pullRequests.totalCount)} all-time`),
      kv('busiest', `${DAYS[s.peakDay]}days`),
      [],
      ['g0', 'g1', 'g2', 'g3', 'g4', 'acc', 'dim', 'ink'].flatMap(c => [['███', c], [' ', '']]),
    ]
    const out = [prompt(s, C, 'fetch').map(([t, c]) => [t, c.replace(' cursor', '')]), []]
    // the IMMUNE/FOMO emblem is drawn by svg() into the blank left area
    info.forEach(l => out.push([[' '.repeat(38), ''], ...l]))
    const rule = (title, w) => [['── ', 'faint'], [title, 'acc'], [' ' + '─'.repeat(Math.max(0, w - [...title].length - 4)), 'faint']]
    out.push(...flow(cfg.sections,
      id => { const [t, l] = BLOCKS[id](s, C - 2); return [[], rule(t, C), [], ...l] },
      (a, b) => {
        const [x, y] = [BLOCKS[a](s, H - 2), BLOCKS[b](s, H - 2)]
        const cx = [rule(x[0], H), [], ...x[1]], cy = [rule(y[0], H), [], ...y[1]]
        return [[], ...Array.from({ length: Math.max(cx.length, cy.length) }, (_, i) => [...padLine(cx[i] || [], H + 4), ...(cy[i] || [])])]
      }))
    out.push([], prompt(s, C))
    return { cols: C, lines: out, emblem: { col: 2, row: 2, scale: 0.6, rows: info.length } }
  },

  receipt(s, cfg) {
    const C = 64, W = 60
    const dash = [['- '.repeat(W / 2).trimEnd(), 'faint']]
    const lead = (k, v) => [[k + ' ', 'dim'], ['.'.repeat(Math.max(1, W - k.length - v.length - 2)), 'faint'], [' ' + v, 'ink']]
    const body = [
      [], center([[[...s.user.login.toUpperCase()].join(' '), 'acc']], W),
      center([[`@${s.user.login} · ${s.user.location || 'earth'} · since ${s.user.createdAt.slice(0, 4)}`, 'dim']], W),
      [], dash, [],
      lead('contributions, 1y', fmt(s.cc.contributionCalendar.totalContributions)),
      lead('commits', fmt(s.commits)),
      lead('pull requests', fmt(s.cc.totalPullRequestContributions)),
      lead('merged PRs, all-time', fmt(s.user.pullRequests.totalCount)),
      lead('streak', `${s.current}d (best ${s.longest}d)`),
      lead('repos', `${s.pub.length} public · ${s.repos.length - s.pub.length} private`),
      lead('followers', fmt(s.user.followers.totalCount)),
      lead('stars', fmt(s.stars)),
    ]
    for (const id of cfg.sections.filter(id => BLOCKS[id])) {
      const [title, lines] = BLOCKS[id](s, W)
      body.push([], dash, center([[title.split(' · ')[0].toUpperCase(), 'acc']], W), dash, [], ...lines)
    }
    // barcode: one bar per week, thicker = busier
    const max = Math.max(...s.weekly, 1)
    const code = s.weekly.map(n => ' ▏▎▍▌▋▊▉█'[n ? 1 + Math.min(7, Math.floor(Math.sqrt(n / max) * 8)) : 0]).join('')
    body.push([], dash, [], ...[0, 1, 2].map(() => center([[code, 'ink']], W)),
      center([['a year of work, one bar per week', 'dim']], W), [],
      center([[`printed ${new Date(s.at).toISOString().slice(0, 10)} · thank you for scrolling`, 'faint']], W), [])
    return { cols: C, lines: body.map(l => [['  ', ''], ...l]) }
  },
}

const mix = (a, b, t) => '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('')
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function svg({ cols, lines, banner, emblem }, c) {
  const g = [c.faint, mix(c.bg, c.acc, 0.35), mix(c.bg, c.acc, 0.6), mix(c.bg, c.acc, 0.85), mix(c.acc, c.ink, 0.35)]
  const W = cols * CW + PAD * 2, H = lines.length * LH + PAD * 2
  const body = lines.map((line, y) => {
    let col = 0, spans = ''
    for (const [text, cls] of line) {
      // emit runs of non-space chars, each glyph pinned to its grid column
      for (const m of text.matchAll(/\S+/g)) {
        const start = col + [...text.slice(0, m.index)].length
        const xs = [...m[0]].map((_, i) => +(PAD + (start + i) * CW).toFixed(1)).join(' ')
        spans += `<tspan x="${xs}"${cls ? ` class="${cls}"` : ''}>${esc(m[0])}</tspan>`
      }
      col += [...text].length
    }
    return spans && `<text y="${PAD + y * LH + 12}" style="animation-delay:${Math.min(y * 35, 1500)}ms">${spans}</text>`
  }).join('\n')
  // banner: merge runs of pixels into rects, faint shadow behind for depth
  let sh = '', px = ''
  if (banner) BANNER.forEach((l, y) => {
    for (const m of l.matchAll(/#+/g)) {
      const x = PAD + (2 + m.index) * CW, top = PAD + y * LH + 2, w = (m[0].length * CW).toFixed(1)
      sh += `<rect x="${(x + 3).toFixed(1)}" y="${top + 3}" width="${w}" height="${LH}"/>`
      px += `<rect x="${x.toFixed(1)}" y="${top}" width="${w}" height="${LH}"/>`
    }
  })
  // emblem: IMMUNE over FOMO in the pixel font, a vertical density fade, and a bright copy revealed by a sliding mask
  let shine = ''
  if (emblem) {
    const word = w => FONT.I.map((_, y) => [...w].map(ch => FONT[ch][y]).join(' '))
    const top = word('IMMUNE'), bot = word('FOMO'), off = (top[0].length - bot[0].length) >> 1
    const grid = [...top, '', ...bot.map(r => ' '.repeat(off) + r)].map(r => r.padEnd(top[0].length + 1))
    const at = (x, y) => grid[y]?.[x] === '#'
    const tint = ['g4', 'g4', 'g3', 'g3', 'g2', 'g2']
    // every glyph pinned to its column; 13.4px makes a block glyph tall enough to tile rows without gaps
    const row = (y, cls, str) => {
      let spans = ''
      for (const m of str.matchAll(/\S+/g)) spans += `<tspan x="${[...m[0]].map((_, i) => +((m.index + i) * CW).toFixed(1)).join(' ')}">${m[0]}</tspan>`
      return spans && `<text class="${cls} em" y="${y * LH + 12.5}">${spans}</text>`
    }
    let base = '', hi = ''
    for (let y = 0; y <= grid.length; y++) {
      base += row(y, 'faint', [...grid[0]].map((_, x) => (!at(x, y) && at(x - 1, y - 1) ? '░' : ' ')).join(''))
      if (y === grid.length) break
      base += row(y, tint[y % 7], [...grid[y]].map(ch => (ch === '#' ? '▓' : ' ')).join(''))
      hi += row(y, 'acc', [...grid[y]].map(ch => (ch === '#' ? '█' : ' ')).join(''))
    }
    const x0 = 0, y0 = 0, ew = grid[0].length * CW, eh = (grid.length + 1) * LH, bw = 160
    // drawn at full size in local units, then scaled down and centered against the info column
    const k = emblem.scale, X = PAD + emblem.col * CW, Y = PAD + emblem.row * LH + (emblem.rows * LH - eh * k) / 2
    shine = `<defs><linearGradient id="band" x1="0" y1="0" x2="1" y2="0.3"><stop offset="0" stop-color="#000"/><stop offset=".5" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>
<mask id="sweep" maskUnits="userSpaceOnUse" x="${x0}" y="${y0}" width="${ew}" height="${eh}"><rect class="shine" x="${x0 - bw}" y="${y0}" width="${bw}" height="${eh}" fill="url(#band)"/></mask></defs>
<g transform="translate(${X},${Y}) scale(${k})"><g>${base}</g><g mask="url(#sweep)">${hi}</g></g>
`
    shine += `<style>.em{font-size:13.4px}.shine{animation:shine 5s ease-in-out 1s infinite}@keyframes shine{from{transform:translateX(0)}65%,to{transform:translateX(${(ew + bw).toFixed(0)}px)}}</style>
`
  }
  const sweep = Array.from({ length: 53 }, (_, x) => `.w${x}{animation-delay:${600 + x * 18}ms}`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${LOGIN} GitHub stats">
<style>
text{font:${FS}px monospace;fill:${c.ink};animation:in .5s ease-out both}
tspan[class*=" w"]{animation:cell .4s ease-out both}
.ink{fill:${c.ink}}.dim{fill:${c.dim}}.faint{fill:${c.faint}}.acc{fill:${c.acc}}${g.map((v, i) => `.g${i}{fill:${v}}`).join('')}${sweep}
.banner{animation:in .8s ease-out both}
.cursor{animation:blink 1.1s steps(1) infinite}
@keyframes in{from{opacity:0}}@keyframes cell{from{fill-opacity:0}}@keyframes blink{50%{opacity:0}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style>
<rect width="100%" height="100%" rx="10" fill="${c.bg}"/>
${banner ? `<defs><linearGradient id="fade" gradientUnits="userSpaceOnUse" x1="0" y1="${PAD}" x2="0" y2="${PAD + BANNER.length * LH}"><stop offset="0" stop-color="${c.ink}"/><stop offset="1" stop-color="${c.acc}"/></linearGradient></defs>
<g class="banner" shape-rendering="crispEdges"><g fill="${c.faint}">${sh}</g><g fill="url(#fade)">${px}</g></g>` : ''}
${shine}${body}
</svg>
`
}

export function renderSVG(data, cfg, theme) {
  const s = stats(data, new Date(data.at))
  return svg((LAYOUTS[cfg.design] || LAYOUTS.dashboard)(s, cfg), cfg.colors[theme])
}

const PRESETS = {
  phosphor: { dark: { bg: '#0d1117', ink: '#e6edf3', dim: '#8b949e', faint: '#30363d', acc: '#39d353' }, light: { bg: '#ffffff', ink: '#1f2328', dim: '#656d76', faint: '#d0d7de', acc: '#1a7f37' } },
  amber: { dark: { bg: '#14110b', ink: '#f4e4c1', dim: '#a8906a', faint: '#3a3226', acc: '#ffb000' }, light: { bg: '#fffaf0', ink: '#2b2112', dim: '#7a6648', faint: '#e5d8bf', acc: '#b86e00' } },
  ice: { dark: { bg: '#0b1220', ink: '#e2ecff', dim: '#8094b4', faint: '#24324a', acc: '#5cc8ff' }, light: { bg: '#f7fbff', ink: '#0f1b2d', dim: '#5a6b85', faint: '#d3deec', acc: '#0a7cc2' } },
  synth: { dark: { bg: '#120b1e', ink: '#f3e8ff', dim: '#9d86c0', faint: '#34264d', acc: '#ff4fd8' }, light: { bg: '#fff7fd', ink: '#2a1235', dim: '#84638f', faint: '#ecd5ea', acc: '#c2189c' } },
  ember: { dark: { bg: '#191414', ink: '#f2e9e4', dim: '#a3918a', faint: '#3b302d', acc: '#ff6b5b' }, light: { bg: '#fbf6ef', ink: '#2d2420', dim: '#8a7a70', faint: '#e6dbcd', acc: '#d94a3a' } },
  mono: { dark: { bg: '#0a0a0a', ink: '#ededed', dim: '#8a8a8a', faint: '#2a2a2a', acc: '#ffffff' }, light: { bg: '#ffffff', ink: '#111111', dim: '#6b6b6b', faint: '#dddddd', acc: '#000000' } },
}

function studio(data, source) {
  const js = source.replace(/<\/script/gi, '<\\/script')
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Profile studio</title>
<style>
:root{--bg:#0b0d10;--panel:#14171c;--line:#262b33;--ink:#e6e8eb;--dim:#8a919c;--acc:#39d353}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:13px/1.45 ui-monospace,monospace}
main{display:grid;grid-template-columns:300px 1fr}
aside{border-right:1px solid var(--line);padding:18px;display:grid;gap:18px;align-content:start;background:var(--panel)}
h2{margin:0 0 8px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);font-weight:500}
.seg{display:flex;gap:4px;flex-wrap:wrap}.seg button,.btn{background:none;border:1px solid var(--line);color:var(--ink);font:inherit;padding:5px 9px;border-radius:6px;cursor:pointer}
.seg button[aria-pressed=true]{border-color:var(--acc);color:var(--acc)}
.sec{display:flex;align-items:center;gap:6px;padding:3px 0}.sec label{flex:1;cursor:pointer}.sec button{background:none;border:0;color:var(--dim);cursor:pointer;font:inherit;padding:0 4px}
.sec button:hover{color:var(--ink)}input[type=checkbox]{accent-color:var(--acc)}
.colors{display:grid;grid-template-columns:auto 1fr 1fr;gap:6px 10px;align-items:center}.colors span{color:var(--dim)}
input[type=color]{width:100%;height:26px;border:1px solid var(--line);border-radius:6px;background:none;padding:2px;cursor:pointer}
section{padding:24px;display:grid;gap:14px;align-content:start;min-width:0}
.stage{border:1px solid var(--line);border-radius:10px;padding:16px;overflow:auto}
.stage img{display:block;max-width:100%;margin:0 auto}
pre{margin:0;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px;overflow:auto;max-height:280px}
.row{display:flex;gap:8px;align-items:center;justify-content:space-between}
@media (max-width:760px){main{grid-template-columns:1fr}aside{border-right:0;border-bottom:1px solid var(--line)}}
</style></head><body><main>
<aside>
  <div><h2>design</h2><div class="seg" id="design"></div></div>
  <div><h2>sections · order</h2><div id="sections"></div></div>
  <div><h2>presets</h2><div class="seg" id="presets"></div></div>
  <div><h2>colors</h2><div class="colors" id="colors"></div></div>
</aside>
<section>
  <div class="row"><div class="seg" id="theme"></div><span style="color:var(--dim)">live data · ${data.at.slice(0, 10)}</span></div>
  <div class="stage" id="stage"><img id="out" alt="preview"></div>
  <div class="row"><h2 style="margin:0">paste this over CONFIG in profile.mjs</h2><button class="btn" id="copy">copy</button></div>
  <pre id="code"></pre>
</section>
</main>
<script type="module">
${js}
const DATA = ${json}
const cfg = JSON.parse(JSON.stringify(CONFIG))
let theme = 'dark'
const $ = id => document.getElementById(id)
const seg = (el, items, cur, on) => {
  el.innerHTML = ''
  for (const v of items) {
    const b = document.createElement('button'); b.textContent = v; b.setAttribute('aria-pressed', v === cur)
    b.onclick = () => on(v); el.append(b)
  }
}
function ui() {
  seg($('design'), DESIGNS, cfg.design, v => { cfg.design = v; ui() })
  seg($('theme'), ['dark', 'light'], theme, v => { theme = v; ui() })
  seg($('presets'), Object.keys(PRESETS), null, v => { cfg.colors = JSON.parse(JSON.stringify(PRESETS[v])); ui() })
  const order = [...cfg.sections, ...Object.keys(SECTIONS).filter(k => !cfg.sections.includes(k))]
  $('sections').innerHTML = ''
  order.forEach(k => {
    const on = cfg.sections.includes(k), i = cfg.sections.indexOf(k)
    const row = document.createElement('div'); row.className = 'sec'
    row.innerHTML = \`<input type="checkbox" id="s-\${k}" \${on ? 'checked' : ''}><label for="s-\${k}">\${SECTIONS[k]}</label>\` +
      (on ? '<button title="up">↑</button><button title="down">↓</button>' : '')
    row.querySelector('input').onchange = e => { e.target.checked ? cfg.sections.push(k) : cfg.sections.splice(i, 1); ui() }
    const [up, down] = row.querySelectorAll('button')
    const move = d => { const j = i + d; if (j < 0 || j >= cfg.sections.length) return; [cfg.sections[i], cfg.sections[j]] = [cfg.sections[j], cfg.sections[i]]; ui() }
    if (up) { up.onclick = () => move(-1); down.onclick = () => move(1) }
    $('sections').append(row)
  })
  $('colors').innerHTML = '<b></b><span>dark</span><span>light</span>'
  for (const k of ['bg', 'ink', 'dim', 'faint', 'acc']) {
    $('colors').insertAdjacentHTML('beforeend', \`<span>\${k}</span><input type="color" data-t="dark" data-k="\${k}" value="\${cfg.colors.dark[k]}"><input type="color" data-t="light" data-k="\${k}" value="\${cfg.colors.light[k]}">\`)
  }
  $('colors').querySelectorAll('input').forEach(inp => inp.oninput = () => { cfg.colors[inp.dataset.t][inp.dataset.k] = inp.value; draw() })
  draw()
}
let url
function draw() {
  if (url) URL.revokeObjectURL(url)
  // no fade-in here: it would replay on every color tweak; the shine keeps moving
  url = URL.createObjectURL(new Blob([renderSVG(DATA, cfg, theme).replace('</style>', 'text,tspan,.banner{animation:none!important}</style>')], { type: 'image/svg+xml' }))
  $('out').src = url
  $('stage').style.background = theme === 'dark' ? '#0d1117' : '#ffffff'
  $('code').textContent = 'export const CONFIG = ' + JSON.stringify(cfg, null, 2)
}
$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText($('code').textContent); $('copy').textContent = 'copied' }
  catch { getSelection().selectAllChildren($('code')); $('copy').textContent = 'select + ⌘C' }
  setTimeout(() => ($('copy').textContent = 'copy'), 1500)
}
ui()
</script></body></html>
`
}

if (globalThis.process && import.meta.url === `file://${process.argv[1]}`) {
  const { writeFileSync, readFileSync, existsSync } = await import('node:fs')
  // DATA=path caches the fetch locally so design iterations don't hit the API
  const data = env.DATA && existsSync(env.DATA) ? JSON.parse(readFileSync(env.DATA, 'utf8')) : await fetchData()
  if (env.DATA && !existsSync(env.DATA)) writeFileSync(env.DATA, JSON.stringify(data))
  if (process.argv[2] === '--studio') writeFileSync(process.argv[3] || 'studio.html', studio(data, readFileSync(new URL(import.meta.url), 'utf8')))
  else for (const t of ['dark', 'light']) writeFileSync(`ascii-${t}.svg`, renderSVG(data, CONFIG, t))
}
