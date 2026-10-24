type MarkdownNode = {
  type?: string
  lang?: string | null
  meta?: string | null
  data?: { hProperties?: Record<string, unknown> }
  children?: MarkdownNode[]
}

export function parseCodeFenceInfo(info: string | undefined) {
  const label = info?.trim() || 'text'
  const language = label.split(/\s+/, 1)[0] || 'text'
  return { label, language }
}

/** Preserve the complete opening-fence info string for the custom code renderer. */
export function remarkCodeFenceInfo() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (node.type === 'code') {
        const label = [node.lang, node.meta].filter(Boolean).join(' ').trim() || 'text'
        node.data ??= {}
        node.data.hProperties = { ...node.data.hProperties, 'data-code-title': label }
      }
      node.children?.forEach(visit)
    }

    visit(tree)
  }
}
