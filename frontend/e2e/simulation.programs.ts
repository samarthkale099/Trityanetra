/**
 * Synthetic Python solutions for the class-scale simulation (simulation.spec.ts):
 * structurally different programs for honest students, and disguised copies
 * (same structure, every name changed, comments added) for planted copy rings.
 */

/** Deterministic random numbers, so a failure can be replayed exactly. */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = <T,>(r: () => number, items: readonly T[]): T => items[Math.floor(r() * items.length)]
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))

const SYLLABLES = ['ka', 'ri', 'to', 'mu', 'sen', 'val', 'dor', 'pix', 'lu', 'qen', 'zar', 'fo', 'bel', 'nim', 'tra', 'wes']
function identifier(r: () => number, used: Set<string>): string {
  for (;;) {
    const name = Array.from({ length: int(r, 2, 3) }, () => pick(r, SYLLABLES)).join('') + (r() < 0.3 ? '_' + pick(r, SYLLABLES) : '')
    if (!used.has(name)) {
      used.add(name)
      return name
    }
  }
}

/**
 * A complete Python program for experiment `exp`. `structureSeed` decides its
 * shape (input style, algorithm style, helper functions); `nameSeed` decides
 * every identifier. A copier reuses the victim's structure seed with their own
 * name seed, which is exactly "renamed the variables and added comments".
 */
export function program(exp: number, structureSeed: number, nameSeed: number, disguise: boolean): string {
  const s = rng(structureSeed)
  const n = rng(nameSeed)
  const used = new Set<string>()
  const v = () => identifier(n, used)
  const [count, arr, acc, item, idx, result] = [v(), v(), v(), v(), v(), v()]
  const lines: string[] = []
  const note = (text: string) => {
    if (disguise) lines.push(`# ${text}`)
  }

  // Helper functions: 1-3, each with its own random structure.
  const helpers: string[] = []
  for (let h = int(s, 1, 3); h > 0; h--) {
    const fn = v()
    const [p, q, t] = [v(), v(), v()]
    helpers.push(fn)
    note('helper')
    lines.push(`def ${fn}(${p}, ${q}):`)
    lines.push(`    ${t} = ${p} ${pick(s, ['+', '-', '*'])} ${q}`)
    for (let k = int(s, 1, 4); k > 0; k--) {
      const c = int(s, 2, 9)
      const shape = pick(s, ['if', 'for', 'while', 'assign'])
      if (shape === 'if') lines.push(`    if ${t} > ${c}:`, `        ${t} = ${t} - ${c}`)
      else if (shape === 'for') lines.push(`    for ${idx} in range(${c}):`, `        ${t} = ${t} + ${idx}`)
      else if (shape === 'while') lines.push(`    while ${t} > ${c * 10}:`, `        ${t} = ${t} // 2`)
      else lines.push(`    ${t} = ${t} ${pick(s, ['+', '*', '%'])} ${c}`)
    }
    lines.push(`    return ${t}`, '')
  }

  // Reading the input: three common styles.
  note('read input')
  const read = pick(s, ['split', 'stdin', 'loop'])
  if (read === 'split') {
    lines.push(`${count} = int(input())`, `${arr} = list(map(int, input().split()))`)
  } else if (read === 'stdin') {
    lines.push('import sys', `${item} = sys.stdin.read().split()`, `${count} = int(${item}[0])`, `${arr} = [int(${idx}) for ${idx} in ${item}[1:]]`)
  } else {
    lines.push(`${count} = int(input())`, `${arr} = []`, `for ${idx} in range(${count}):`, `    ${arr}.append(int(input()))`)
  }

  // The experiment's task, in a loop style or a built-in style.
  note('solve')
  const loop = s() < 0.5
  const tasks: Array<() => void> = [
    () => (loop ? lines.push(`${acc} = 0`, `for ${item} in ${arr}:`, `    ${acc} = ${acc} + ${item}`) : lines.push(`${acc} = sum(${arr})`)),
    () => (loop ? lines.push(`${acc} = ${arr}[0]`, `for ${item} in ${arr}:`, `    if ${item} > ${acc}:`, `        ${acc} = ${item}`) : lines.push(`${acc} = max(${arr})`)),
    () => (loop ? lines.push(`${acc} = 0`, `for ${item} in ${arr}:`, `    if ${item} % 2 == 0:`, `        ${acc} += 1`) : lines.push(`${acc} = len([${item} for ${item} in ${arr} if ${item} % 2 == 0])`)),
    () => (loop ? lines.push(`${acc} = []`, `for ${idx} in range(len(${arr}) - 1, -1, -1):`, `    ${acc}.append(${arr}[${idx}])`) : lines.push(`${acc} = ${arr}[::-1]`)),
    () => (loop ? lines.push(`${acc} = 0`, `for ${item} in ${arr}:`, `    ${acc} += ${item}`, `${acc} = ${acc} / ${count}`) : lines.push(`${acc} = sum(${arr}) / len(${arr})`)),
    () => (loop ? lines.push(`${acc} = 1`, `for ${item} in ${arr}:`, `    ${acc} = (${acc} * ${item}) % 1000007`) : lines.push('import math', `${acc} = math.prod(${arr}) % 1000007`)),
    () => (loop ? lines.push(`${acc} = list(${arr})`, `for ${idx} in range(len(${acc})):`, `    for ${item} in range(len(${acc}) - 1 - ${idx}):`, `        if ${acc}[${item}] > ${acc}[${item} + 1]:`, `            ${acc}[${item}], ${acc}[${item} + 1] = ${acc}[${item} + 1], ${acc}[${item}]`) : lines.push(`${acc} = sorted(${arr})`)),
    () => (loop ? lines.push(`${acc} = []`, `${result} = 0`, `for ${item} in ${arr}:`, `    ${result} += ${item}`, `    ${acc}.append(${result})`) : lines.push('import itertools', `${acc} = list(itertools.accumulate(${arr}))`)),
    () => (loop ? lines.push(`${acc} = {}`, `for ${item} in ${arr}:`, `    ${acc}[${item}] = ${acc}.get(${item}, 0) + 1`, `${acc} = max(${acc}, key=${acc}.get)`) : lines.push('from collections import Counter', `${acc} = Counter(${arr}).most_common(1)[0][0]`)),
    () => (loop ? lines.push(`${acc} = 0`, `for ${item} in ${arr}:`, `    if ${item} < 0:`, `        ${acc} += 1`) : lines.push(`${acc} = sum(1 for ${item} in ${arr} if ${item} < 0)`)),
  ]
  tasks[exp % tasks.length]()

  // Use the helpers so they are part of the program, then print.
  note('output')
  lines.push(`${result} = ${helpers.map((h) => `${h}(${count}, 1)`).join(' + ')}`)
  lines.push(`print(${acc})`)
  if (s() < 0.5) lines.push(`print(${result} * 0)`)
  return lines.join('\n') + '\n'
}

/** Planted answer key for one experiment: three copy rings of 2, 3 and 4 students. */
export function copyRings(exp: number): number[][] {
  const r = rng(9_000 + exp)
  const order = Array.from({ length: 50 }, (_, i) => i).sort(() => r() - 0.5)
  return [order.slice(0, 2), order.slice(2, 5), order.slice(5, 9)]
}

