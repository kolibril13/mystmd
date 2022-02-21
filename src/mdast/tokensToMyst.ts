import { MarkdownParseState } from './fromMarkdown'
import type { Root } from 'mdast'
import { Spec, Token, Container, Admonition, AdmonitionKind } from './types'
import { visit } from 'unist-util-visit'
import { remove } from 'unist-util-remove'
import he from 'he'
import { GenericNode } from '.'
import { admonitionKindToTitle, withoutTrailingNewline } from './utils'
import { map } from 'unist-util-map'
import { findAfter } from 'unist-util-find-after'

export { MarkdownParseState }

export type Options = {
  handlers?: Record<string, Spec>
  hoistSingleImagesOutofParagraphs?: boolean
}

function getClassName(token: Token, exclude?: RegExp): string | undefined {
  const className: string = token.meta?.class?.join(' ') || token.attrGet('class')
  if (!className) return undefined
  return (
    className
      .split(' ')
      .map((c) => c.trim())
      .filter((c) => c && !(exclude && c.match(exclude)))
      .join(' ') || undefined
  )
}

function hasClassName(token: Token, matcher: RegExp): false | RegExpMatchArray {
  const className = getClassName(token)
  if (!className) return false
  const matches = className
    .split(' ')
    .map((c) => c.match(matcher))
    .filter((c) => c)
  if (matches.length === 0) return false
  return matches[0] as RegExpMatchArray
}

function getLang(t: Token) {
  return he.decode(t.info).trim().split(' ')[0].replace('\\', '')
}

function normalizeLabel(label: string | undefined) {
  return label?.replace(/[\s]+/g, ' ').trim().toLowerCase()
}

const defaultMdast: Record<string, Spec> = {
  heading: {
    type: 'heading',
    getAttrs(token) {
      return { depth: Number(token.tag[1]) }
    },
  },
  hr: {
    type: 'thematicBreak',
    noCloseToken: true,
    isLeaf: true,
  },
  paragraph: {
    type: 'paragraph',
  },
  blockquote: {
    type: 'blockquote',
  },
  ordered_list: {
    type: 'list',
    getAttrs(token, tokens, index) {
      const info = tokens[index + 1]?.info
      const start = Number(tokens[index + 1]?.info)
      return {
        ordered: true,
        start: isNaN(start) || !info ? 1 : start,
        spread: false,
      }
    },
  },
  bullet_list: {
    type: 'list',
    attrs: {
      ordered: false,
      spread: false,
    },
  },
  list_item: {
    type: 'listItem',
    attrs: {
      spread: true,
    },
  },
  em: {
    type: 'emphasis',
  },
  strong: {
    type: 'strong',
  },
  fence: {
    // TODO
    type: 'code',
    isLeaf: true,
    getAttrs(t) {
      return { lang: getLang(t), value: withoutTrailingNewline(t.content) }
    },
  },
  code_block: {
    type: 'code',
    isLeaf: true,
    getAttrs(t) {
      return { lang: getLang(t), value: withoutTrailingNewline(t.content) }
    },
  },
  code_inline: {
    type: 'inlineCode',
    noCloseToken: true,
    isText: true,
  },
  hardbreak: {
    type: 'break',
    noCloseToken: true,
    isLeaf: true,
  },
  link: {
    type: 'link',
    getAttrs(token) {
      return {
        url: token.attrGet('href'),
        title: token.attrGet('title') ?? undefined,
      }
    },
  },
  image: {
    type: 'image',
    noCloseToken: true,
    isLeaf: true,
    getAttrs(token) {
      const alt =
        token.attrGet('alt') || token.children?.reduce((i, t) => i + t?.content, '')
      const alignMatch = hasClassName(token, /align-(left|right|center)/)
      const align = alignMatch ? alignMatch[1] : undefined
      return {
        url: token.attrGet('src'),
        alt: alt || undefined,
        title: token.attrGet('title') || undefined,
        class: getClassName(token, /align-(?:left|right|center)/),
        width: token.attrGet('width') || undefined,
        align,
      }
    },
  },
  abbr: {
    type: 'abbreviation',
    getAttrs(token) {
      const value = token.children?.[0]?.content
      return {
        title: token.attrGet('title') ?? undefined,
        value,
      }
    },
  },
  sub: {
    type: 'subscript',
  },
  sup: {
    type: 'superscript',
  },
  dl: {
    type: 'definitionList',
  },
  dt: {
    type: 'definitionTerm',
  },
  dd: {
    type: 'definitionDescription',
  },
  admonition: {
    type: 'admonition',
    getAttrs(token) {
      const kind = token.meta?.kind || undefined
      return {
        kind,
        class: getClassName(token, new RegExp(`admonition|${kind}`)),
      }
    },
  },
  admonition_title: {
    type: 'admonitionTitle',
  },
  figure: {
    type: 'container',
    getAttrs(token): Container {
      const name = token.meta?.name || undefined
      return {
        kind: 'figure',
        identifier: normalizeLabel(name),
        label: name,
        numbered: name ? true : undefined,
        class: getClassName(token, /numbered/),
      }
    },
  },
  figure_caption: {
    type: 'caption',
  },
  math_inline: {
    type: 'inlineMath',
    noCloseToken: true,
    isText: true,
  },
  math_inline_double: {
    type: 'math',
    noCloseToken: true,
    isText: true,
  },
  math_block: {
    type: 'math',
    noCloseToken: true,
    isText: true,
    getAttrs(t) {
      const info = t.info || undefined
      return { identifier: normalizeLabel(info), label: info }
    },
  },
  math_block_label: {
    type: 'math',
    noCloseToken: true,
    isText: true,
    getAttrs(t) {
      const info = t.info || undefined
      return {
        identifier: normalizeLabel(info),
        label: info,
      }
    },
  },
  amsmath: {
    type: 'math',
    noCloseToken: true,
    isText: true,
  },
  ref: {
    type: 'contentReference',
    isLeaf: true,
    getAttrs(t) {
      return {
        kind: t.meta.kind,
        identifier: normalizeLabel(t.meta.name),
        label: t.meta.name,
        value: t.meta.value || undefined,
      }
    },
  },
  footnote_ref: {
    type: 'footnoteReference',
    noCloseToken: true,
    isLeaf: true,
    getAttrs(t) {
      return {
        identifier: normalizeLabel(t?.meta?.label),
        label: t?.meta?.label,
      }
    },
  },
  footnote_anchor: {
    type: '_remove',
    noCloseToken: true,
  },
  footnote_block: {
    // The footnote block is a view concern, not AST
    // Lift footnotes out of the tree
    type: '_lift',
  },
  footnote: {
    type: 'footnoteDefinition',
    getAttrs(t) {
      return {
        identifier: normalizeLabel(t?.meta?.label),
        label: t?.meta?.label,
      }
    },
  },
  directive: {
    type: 'directive',
    noCloseToken: true,
    isLeaf: true,
    getAttrs(t) {
      return {
        kind: t.info,
        args: t?.meta?.arg || undefined,
        value: t.content.trim(),
      }
    },
  },
  directive_error: {
    type: 'directiveError',
    noCloseToken: true,
  },
  role: {
    type: 'role',
    noCloseToken: true,
    isLeaf: true,
    getAttrs(t) {
      return {
        kind: t.meta.name,
        value: t.content,
      }
    },
  },
  myst_target: {
    type: '_headerTarget',
    noCloseToken: true,
    isLeaf: true,
    getAttrs(t) {
      return {
        identifier: normalizeLabel(t.content),
        label: t.content,
      }
    },
  },
  html_inline: {
    type: 'html',
    noCloseToken: true,
    isText: true,
  },
  html_block: {
    type: 'html',
    noCloseToken: true,
    isText: true,
  },
  myst_block_break: {
    type: 'blockBreak',
    noCloseToken: true,
    isLeaf: true,
    getAttrs(t) {
      return {
        value: t.content || undefined,
      }
    },
  },
  myst_line_comment: {
    type: 'comment',
    noCloseToken: true,
    isLeaf: true,
    getAttrs(t) {
      return {
        value: t.content.trim() || undefined,
      }
    },
  },
}

export function hoistSingleImagesOutofParagraphs(tree: Root) {
  // Hoist up all paragraphs with a single image
  visit(tree, 'paragraph', (node: GenericNode) => {
    if (!(node.children?.length === 1 && node.children?.[0].type === 'image')) return
    const child = node.children[0]
    Object.keys(node).forEach((k) => {
      delete node[k]
    })
    Object.assign(node, child)
  })
}

const defaultOptions: Options = {
  handlers: defaultMdast,
  hoistSingleImagesOutofParagraphs: true,
}

export function tokensToMyst(tokens: Token[], options = defaultOptions): Root {
  const opts = {
    ...defaultOptions,
    ...options,
    handlers: { ...defaultOptions.handlers, ...options?.handlers },
  }
  const state = new MarkdownParseState(opts.handlers)
  state.parseTokens(tokens)
  let tree: Root
  do {
    tree = state.closeNode() as Root
  } while (state.stack.length)

  // Remove all redundant nodes marked for removal
  remove(tree, '_remove')

  // Lift up all nodes that are named "lift"
  tree = map(tree, (node: GenericNode) => {
    const children = node.children?.map((child: GenericNode) => {
      if (child.type === '_lift') return child.children
      return child
    })
    node.children = children?.flat()
    return node
  }) as Root

  // Remove unnecessary admonition titles from AST
  // These are up to the serializer to put in
  visit(tree, 'admonition', (node: Admonition) => {
    const { kind, children } = node
    if (!kind || !children || kind === AdmonitionKind.admonition) return
    const expectedTitle = admonitionKindToTitle(kind)
    const titleNode = children[0]
    if (
      titleNode.type === 'admonitionTitle' &&
      titleNode.children?.[0]?.value === expectedTitle
    )
      node.children = children.slice(1)
  })

  visit(tree, 'contentReference', (node: GenericNode) => {
    delete node.children
  })

  // Add target values as identifiers to subsequent node
  visit(tree, '_headerTarget', (node: GenericNode) => {
    const nextNode = findAfter(tree, node) as GenericNode
    if (nextNode) {
      nextNode.identifier = node.identifier
      nextNode.label = node.label
    }
  })
  remove(tree, '_headerTarget')

  if (opts.hoistSingleImagesOutofParagraphs) hoistSingleImagesOutofParagraphs(tree)

  return tree
}
