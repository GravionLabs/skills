interface Token {
  type: string;
  content: string;
  children: Token[] | null;
}

interface MarkdownIt {
  core: {
    ruler: { push(name: string, rule: (state: { tokens: Token[] }) => void): void };
  };
}

/**
 * With `markdown.html: false` an HTML comment is shown as text. The docs carry marker comments
 * such as `<!-- AUTO:start version -->` for generators; they must not appear on the site.
 * Code spans and fences are other token types and keep their comments.
 */
export function stripHtmlComments(md: MarkdownIt): void {
  md.core.ruler.push('strip_html_comments', (state) => {
    for (const token of state.tokens) {
      if (token.type !== 'inline') continue;
      for (const child of token.children ?? []) {
        if (child.type === 'text') child.content = child.content.replace(/<!--[\s\S]*?-->/g, '');
      }
    }
  });
}
