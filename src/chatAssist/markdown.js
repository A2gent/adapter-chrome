// Renders agent markdown by building DOM nodes. Gmail enforces Trusted Types, which blocks innerHTML,
// and replies quote other people's messages, so raw HTML must stay plain text.
(() => {
  if (globalThis.__A2GENT_CHAT_ASSIST_MARKDOWN__) return;

  const FENCE = /^\s*(`{3,}|~{3,})/;
  const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
  const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
  const QUOTE = /^\s{0,3}>\s?/;
  const LIST = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(.*)$/;
  const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
  const UNESCAPED_PIPE = /(?<!\\)\|/;
  const INLINE = new RegExp([
    /\\(?<escaped>[\\`*_~[\]()|#>-])/.source,
    /(?<ticks>`+)(?<code>.+?)\k<ticks>/.source,
    /<br\s*\/?>(?<br>)/.source,
    /\*\*(?<strong>.+?)\*\*(?!\*)/.source,
    /(?<![\p{L}\p{N}_])__(?<underscoreStrong>.+?)__(?![\p{L}\p{N}_])/.source,
    /~~(?<del>.+?)~~/.source,
    /\*(?<em>[^\s*](?:[^*]*[^\s*])?)\*/.source,
    /(?<![\p{L}\p{N}_])_(?<underscoreEm>[^\s_](?:[^_]*[^\s_])?)_(?![\p{L}\p{N}_])/.source,
    /\[(?<label>[^\]]+)\]\((?<href>[^)\s]+)\)/.source,
    /(?<url>https?:\/\/[^\s<>)]*[^\s<>).,;:!?])/.source,
  ].join('|'), 'gu');

  const create = (tag, props = {}) => Object.assign(document.createElement(tag), props);
  const indentOf = (line) => line.match(/^\s*/)[0].length;
  const nextFilled = (lines, start) => {
    let index = start;
    while (index < lines.length && !lines[index].trim()) index += 1;
    return index;
  };
  const isTable = (lines, index) => lines[index].includes('|') && Boolean(lines[index + 1]?.includes('|')) && TABLE_DELIMITER.test(lines[index + 1]);
  const startsBlock = (lines, index) => !lines[index].trim() || [FENCE, HEADING, RULE, QUOTE, LIST].some((pattern) => pattern.test(lines[index])) || isTable(lines, index);
  const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(UNESCAPED_PIPE).map((cell) => cell.trim());

  const link = (href, fill) => {
    // A reply can repeat a link from the conversation; javascript: and similar schemes stay plain text.
    if (!/^https?:\/\//i.test(href)) return null;
    const node = create('a', { href, target: '_blank', rel: 'noopener noreferrer' });
    fill(node);
    return node;
  };

  const wrap = (tag, text) => {
    const node = create(tag);
    inline(node, text);
    return node;
  };

  const inlineNode = (raw, groups) => {
    if (groups.escaped !== undefined) return groups.escaped;
    if (groups.code !== undefined) return create('code', { textContent: groups.code.trim() });
    if (groups.br !== undefined) return create('br');
    if (groups.strong !== undefined || groups.underscoreStrong !== undefined) return wrap('strong', groups.strong ?? groups.underscoreStrong);
    if (groups.del !== undefined) return wrap('del', groups.del);
    if (groups.em !== undefined || groups.underscoreEm !== undefined) return wrap('em', groups.em ?? groups.underscoreEm);
    if (groups.href !== undefined) return link(groups.href, (node) => inline(node, groups.label)) || raw;
    return link(groups.url, (node) => { node.textContent = groups.url; });
  };

  const inline = (parent, text) => {
    let last = 0;
    for (const match of text.matchAll(INLINE)) {
      parent.append(text.slice(last, match.index), inlineNode(match[0], match.groups));
      last = match.index + match[0].length;
    }
    parent.append(text.slice(last));
  };

  const fence = (out, lines, start) => {
    const marker = lines[start].match(FENCE)[1];
    let end = start + 1;
    while (end < lines.length && !lines[end].trim().startsWith(marker)) end += 1;
    const pre = create('pre');
    pre.append(create('code', { textContent: lines.slice(start + 1, end).join('\n') }));
    out.append(pre);
    return end + 1;
  };

  const table = (out, lines, start) => {
    const header = splitRow(lines[start]);
    const aligns = splitRow(lines[start + 1]).map((cell) => {
      if (cell.startsWith(':') && cell.endsWith(':')) return 'center';
      return cell.endsWith(':') ? 'right' : '';
    });
    const row = (tag, cells) => {
      const node = create('tr');
      header.forEach((_, column) => {
        const cell = wrap(tag, cells[column] ?? '');
        if (aligns[column]) cell.style.textAlign = aligns[column];
        node.append(cell);
      });
      return node;
    };
    const head = create('thead');
    head.append(row('th', header));
    const body = create('tbody');
    let index = start + 2;
    while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
      body.append(row('td', splitRow(lines[index])));
      index += 1;
    }
    const node = create('table');
    node.append(head, body);
    out.append(node);
    return index;
  };

  const quote = (out, lines, start) => {
    let end = start;
    while (end < lines.length && QUOTE.test(lines[end])) end += 1;
    const node = create('blockquote');
    node.append(blocks(lines.slice(start, end).map((line) => line.replace(QUOTE, ''))));
    out.append(node);
    return end;
  };

  const list = (out, lines, start) => {
    const ordered = /\d/.test(lines[start].match(LIST)[2]);
    const node = create(ordered ? 'ol' : 'ul');
    if (ordered) node.start = Number.parseInt(lines[start].match(LIST)[2], 10);
    let index = start;
    while (index < lines.length) {
      const match = lines[index].match(LIST);
      if (!match || RULE.test(lines[index]) || /\d/.test(match[2]) !== ordered) break;
      const width = match[1].length + match[2].length + match[3].length;
      const body = [match[4]];
      index += 1;
      let next = nextFilled(lines, index);
      // Agents indent nested content by 2 spaces even under "1. ", so any deeper line belongs to the item.
      while (next < lines.length && indentOf(lines[next]) > match[1].length) {
        body.push(...lines.slice(index, next), lines[next].slice(Math.min(indentOf(lines[next]), width)));
        index = next + 1;
        next = nextFilled(lines, index);
      }
      index = next;
      const item = create('li');
      item.append(blocks(body));
      node.append(item);
    }
    out.append(node);
    return index;
  };

  const paragraph = (out, lines, start) => {
    const node = create('p');
    let index = start;
    do {
      if (index > start) node.append(create('br'));
      inline(node, lines[index].trim());
      index += 1;
    } while (index < lines.length && !startsBlock(lines, index));
    out.append(node);
    return index;
  };

  const blocks = (lines) => {
    const out = document.createDocumentFragment();
    let index = nextFilled(lines, 0);
    while (index < lines.length) {
      const line = lines[index];
      const heading = line.match(HEADING);
      if (FENCE.test(line)) index = fence(out, lines, index);
      else if (heading) {
        out.append(wrap(`h${heading[1].length}`, heading[2]));
        index += 1;
      } else if (RULE.test(line)) {
        out.append(create('hr'));
        index += 1;
      } else if (isTable(lines, index)) index = table(out, lines, index);
      else if (QUOTE.test(line)) index = quote(out, lines, index);
      else if (LIST.test(line)) index = list(out, lines, index);
      else index = paragraph(out, lines, index);
      index = nextFilled(lines, index);
    }
    return out;
  };

  globalThis.__A2GENT_CHAT_ASSIST_MARKDOWN__ = (text) => blocks(text.replace(/\t/g, '    ').split(/\r?\n/));
})();
