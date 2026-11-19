// Pure module: turns a post's stored HTML into safe paragraphs for the magazine.
// The post text is used as it is; only the markup is reduced to what a page needs.

const INLINE = new Set(["strong", "b", "em", "i", "sup", "sub"]);
const BLOCK = new Set(["p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "tr"]);
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|svg|noscript)\b[\s\S]*?<\/\1\s*>/gi;
const ENTITY = /^&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,30});/i;

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Escapes text taken from stored HTML, keeping entities that are already well formed. */
function safeText(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "&") {
      const match = ENTITY.exec(text.slice(i, i + 40));
      if (match) {
        out += match[0];
        i += match[0].length - 1;
      } else out += "&amp;";
    } else if (char === "<") out += "&lt;";
    else if (char === ">") out += "&gt;";
    else out += char;
  }
  return out;
}

const isBlank = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&nbsp;|&#160;|\s/gi, "") === "";

/**
 * Paragraphs of the post as HTML that contains only strong, em, sup and sub.
 * Every attribute, link, script and style is removed.
 */
export function toParagraphs(html: string): string[] {
  const source = html.replace(DROP_WITH_CONTENT, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const paragraphs: string[] = [];
  let current = "";
  const open: string[] = [];

  const closeAll = () => [...open].reverse().map((tag) => `</${tag}>`).join("");
  const reopen = () => open.map((tag) => `<${tag}>`).join("");
  const flush = () => {
    const paragraph = (current + closeAll()).replace(/\s+/g, " ").trim();
    if (!isBlank(paragraph)) paragraphs.push(paragraph);
    current = reopen();
  };

  const tagPattern = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
  let last = 0;
  let previousWasBreak = false;
  for (let match = tagPattern.exec(source); match; match = tagPattern.exec(source)) {
    const text = source.slice(last, match.index);
    if (text.trim()) previousWasBreak = false;
    current += safeText(text);
    last = match.index + match[0].length;

    const closing = match[1] === "/";
    let name = match[2].toLowerCase();
    if (name === "b") name = "strong";
    if (name === "i") name = "em";

    if (BLOCK.has(name)) {
      flush();
      previousWasBreak = false;
    } else if (name === "br") {
      // One line break is a space; two in a row start a new paragraph.
      if (previousWasBreak) flush();
      else current += " ";
      previousWasBreak = !previousWasBreak;
    } else if (INLINE.has(name)) {
      if (!closing) {
        open.push(name);
        current += `<${name}>`;
      } else {
        const index = open.lastIndexOf(name);
        if (index >= 0) {
          // Close anything opened after it, then reopen those, so tags stay nested.
          const after = open.splice(index);
          current += [...after].reverse().map((tag) => `</${tag}>`).join("");
          current += after.slice(1).map((tag) => `<${tag}>`).join("");
          open.push(...after.slice(1));
        }
      }
    }
    // Any other tag (span, a, font, img ...) is dropped; its text stays.
  }
  current += safeText(source.slice(last));
  flush();

  // A paragraph that is bold from start to end is body text someone made bold, not emphasis.
  return paragraphs.map((paragraph) => {
    const whole = /^<strong>((?:(?!<\/?strong>)[\s\S])*)<\/strong>$/.exec(paragraph);
    return whole && paragraphs.length > 1 && whole[1].length > 160 ? whole[1] : paragraph;
  });
}
