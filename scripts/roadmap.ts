/*
 * Builds ROADMAP.md from features/, and checks features/ is consistent.
 *
 *   bun run roadmap           regenerate ROADMAP.md
 *   bun run roadmap --check   fail if features/ is invalid or ROADMAP.md is stale (CI)
 *
 * features/Phase N/Phase N.md is the phase's outline: its goal, then each area
 * as a callout ("> [!area] Name") holding a list of [[Feature]] links, nested
 * for sub-features. Each
 * feature is one file beside it (features/Phase N/<Feature>.md): frontmatter,
 * a one-line summary, then optional details. See AGENTS.md → Features.
 *
 * Every feature's frontmatter lists its properties in one order, leaving out
 * empty ones; native is always there, true or false. area, parent and
 * subfeatures come from the outline: this script writes them, and --check fails
 * when they're stale. It prints each feature file it rewrites.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, relative, sep } from "node:path"

const root = join(import.meta.dir, "..")
const featuresDir = join(root, "features")
const output = join(root, "ROADMAP.md")

const STATUSES = ["idea", "planned", "in-progress", "done"] as const
type Status = (typeof STATUSES)[number]
/** Every property, in the order frontmatter lists them. */
const ORDER = [
  "status",
  "priority",
  "native",
  "area",
  "parent",
  "subfeatures",
] as const
const KEYS = new Set<string>(ORDER)
const PRIORITIES = ["high", "medium", "low"]
const MAX_SUMMARY = 140
const BAD_NAME = /[\\/:#^|[\]?*"<>]/

type Feature = {
  title: string
  path: string
  phase: number
  status: Status
  summary: string
  data: Record<string, unknown>
  frontmatter: string
  body: string
  area?: string
  parent?: string
  subfeatures: string[]
}

const errors: string[] = []
/** A path from the repo root with forward slashes, the same on every platform. */
const repoPath = (path: string) => relative(root, path).split(sep).join("/")
const fail = (path: string, message: string) =>
  errors.push(`${repoPath(path)}: ${message}`)

function parse(path: string) {
  const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n")
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match)
    return { data: {} as Record<string, unknown>, body: text, frontmatter: "" }
  let data: unknown
  try {
    data = Bun.YAML.parse(match[1])
  } catch (error) {
    fail(path, `frontmatter isn't valid YAML (${(error as Error).message})`)
  }
  return {
    data: (data && typeof data === "object" ? data : {}) as Record<
      string,
      unknown
    >,
    body: match[2],
    frontmatter: match[1],
  }
}

const phases = readdirSync(featuresDir)
  .map((name) => name.match(/^Phase (\d+)$/))
  .filter((m): m is RegExpMatchArray => !!m)
  .map((m) => Number(m[1]))
  .sort((a, b) => a - b)

/** Every .md under features/ that isn't a template must be a phase outline or a feature beside it. */
const isFeatureFile = (rel: string) => /^Phase \d+\/[^/]+\.md$/.test(rel)
for (const rel of readdirSync(featuresDir, { recursive: true }) as string[]) {
  const path = rel.split(sep).join("/")
  if (
    path.endsWith(".md") &&
    !path.startsWith("_templates/") &&
    !isFeatureFile(path)
  )
    fail(
      join(featuresDir, rel),
      "features go in features/Phase N/, beside its outline"
    )
}

/** After the summary, a feature's details are only these callouts, each at most once, in this order (AGENTS.md → Features). */
const SECTIONS = ["demo", "use", "how", "todo", "out"]
function checkSections(path: string, body: string) {
  const blocks = body
    .trim()
    .split(/\n\s*\n/)
    .slice(1)
  let last = -1
  for (const block of blocks) {
    const type = block.match(/^> \[!(\w+)\]/)?.[1]
    const at = type ? SECTIONS.indexOf(type) : -1
    if (at < 0) {
      fail(
        path,
        `details go in > [!${SECTIONS.join("], [!")}] callouts: ${block.split("\n")[0]}`
      )
      return
    }
    if (at <= last) fail(path, `[!${type}] is out of order or repeated`)
    last = at
    if (block.split("\n").some((line) => !line.startsWith(">")))
      fail(path, `every line of [!${type}] starts with ">"`)
  }
}

const features = new Map<string, Feature>()
for (const phase of phases) {
  const dir = join(featuresDir, `Phase ${phase}`)
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md") || file === `Phase ${phase}.md`) continue
    const path = join(dir, file)
    const title = file.slice(0, -3)
    if (BAD_NAME.test(title))
      fail(path, `name can't contain \\ / : # ^ | [ ] ? * " < >`)
    if (features.has(title)) fail(path, `another feature is named "${title}"`)
    const { data, body, frontmatter } = parse(path)
    for (const key of Object.keys(data))
      if (!KEYS.has(key)) fail(path, `unknown property "${key}"`)
    const status = data.status as Status
    if (!STATUSES.includes(status))
      fail(path, `status must be one of ${STATUSES.join(", ")}`)
    if (status === "done" && data.priority != null)
      fail(path, "done features have no priority (leave it empty)")
    else if (status !== "done" && !PRIORITIES.includes(data.priority as string))
      fail(path, `priority must be one of ${PRIORITIES.join(", ")}`)
    if (data.native != null && typeof data.native !== "boolean")
      fail(path, "native must be true or false")
    const summary = body.trim().split("\n")[0]?.trim() ?? ""
    if (!summary || summary.startsWith(">") || summary.startsWith("#"))
      fail(path, "must start with a one-line summary")
    else if (summary.length > MAX_SUMMARY)
      fail(path, `summary is over ${MAX_SUMMARY} characters`)
    checkSections(path, body)
    features.set(title, {
      title,
      path,
      phase,
      status,
      summary,
      data,
      frontmatter,
      body,
      subfeatures: [],
    })
  }
}

const MARK: Record<Status, string> = {
  done: "[x]",
  "in-progress": "[ ]",
  planned: "[ ]",
  idea: "[ ]",
}
const listed = new Set<string>()
const sections: string[] = []
for (const phase of phases) {
  const path = join(featuresDir, `Phase ${phase}`, `Phase ${phase}.md`)
  if (!existsSync(path)) {
    fail(path, "missing phase outline")
    continue
  }
  const { data, body } = parse(path)
  const name = typeof data.name === "string" ? `: ${data.name}` : ""
  const lines = [`## Phase ${phase}${name}`, ""]
  let area: string | undefined
  /** The links above this one, by indent, for finding its parent. */
  const above: { indent: number; title: string }[] = []
  for (const raw of body.trim().split("\n")) {
    // Areas are callouts ("> [!area] Production"): their lines keep the "> " in ROADMAP.md.
    const quote = /^>[ ]?/.exec(raw)?.[0] ?? ""
    const line = raw.slice(quote.length)
    const header = line.match(/^\[!area\][+-]?\s*(.*)$/)
    if (header) {
      area = header[1]!.trim() || undefined
      above.length = 0
    } else if (!quote && line.trim()) area = undefined
    const link = line.match(/^(\s*)(- |\d+\. )\[\[([^\]|]+)\]\]\s*$/)
    if (!link && line.includes("[[")) {
      fail(
        path,
        `links go on their own line, as "- [[Feature]]" (or "> - [[Feature]]" in an area): ${line.trim()}`
      )
      continue
    }
    if (!link) {
      lines.push(quote + (line.startsWith("#") ? `#${line}` : line))
      continue
    }
    const [, indent, bullet, title] = link
    const feature = features.get(title)
    if (!feature) {
      fail(path, `[[${title}]] has no file`)
      continue
    }
    if (feature.phase !== phase)
      fail(path, `[[${title}]] is in Phase ${feature.phase}'s folder`)
    if (listed.has(title)) fail(path, `[[${title}]] is listed twice`)
    listed.add(title)
    feature.area = area
    while (above.length && above.at(-1)!.indent >= indent.length) above.pop()
    const parent = above.at(-1)?.title
    if (parent) {
      feature.parent = parent
      features.get(parent)!.subfeatures.push(title)
    }
    above.push({ indent: indent.length, title })
    const href = encodeURI(repoPath(feature.path))
    lines.push(
      `${quote}${indent}${bullet}${MARK[feature.status]} [${title}](${href}): ${feature.summary}`
    )
  }
  sections.push(lines.join("\n"))
}
for (const feature of features.values())
  if (!listed.has(feature.title))
    fail(feature.path, `not listed in Phase ${feature.phase}.md`)

const link = (title: string) => `[[${title}]]`
const scalar = (value: unknown) =>
  typeof value === "string" && !/^[\w.-]+$/.test(value)
    ? JSON.stringify(value)
    : String(value)
/** The frontmatter a feature should have: its properties in ORDER, leaving out empty ones (native: false stays). */
function frontmatterOf(feature: Feature) {
  const { data } = feature
  const values: Record<(typeof ORDER)[number], unknown> = {
    status: data.status,
    priority: data.priority,
    native: data.native ?? false,
    area: feature.area,
    parent: feature.parent && link(feature.parent),
    subfeatures: feature.subfeatures.map(link),
  }
  return ORDER.flatMap((key) => {
    const value = values[key]
    if (value == null || (Array.isArray(value) && !value.length)) return []
    if (!Array.isArray(value)) return [`${key}: ${scalar(value)}`]
    return [`${key}:`, ...value.map((item) => `  - ${scalar(item)}`)]
  }).join("\n")
}
const check = process.argv.includes("--check")
const stale: Feature[] = []
for (const feature of features.values())
  if (feature.frontmatter !== frontmatterOf(feature)) stale.push(feature)
if (check && stale.length)
  for (const feature of stale)
    fail(
      feature.path,
      "properties are out of date (area, parent, subfeatures, order or an empty one): run `bun run roadmap`"
    )

const roadmap = `# Roadmap

<!-- Generated by \`bun run roadmap\` from features/. Edit those files, not this one. -->

Phases are rough order, not releases. Each feature's file in [features/](features) has its details.

${sections.join("\n\n")}
`

if (errors.length) {
  console.error(errors.join("\n"))
  process.exit(1)
}
const current = existsSync(output) ? readFileSync(output, "utf8") : ""
if (check) {
  if (current !== roadmap) {
    console.error("ROADMAP.md is out of date: run `bun run roadmap`")
    process.exit(1)
  }
} else {
  for (const feature of stale) {
    writeFileSync(
      feature.path,
      `---\n${frontmatterOf(feature)}\n---\n${feature.body}`
    )
    console.log(repoPath(feature.path))
  }
  if (current !== roadmap) {
    writeFileSync(output, roadmap)
    console.log(repoPath(output))
  }
}
