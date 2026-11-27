// Visual tree export: a horizontal (left-to-right) tidy diagram — boxes joined by
// smooth curved (cubic Bézier) connectors, checkmarks for done tasks, progress
// badges on parents. Vector PDF via jsPDF.
import { jsPDF } from 'jspdf';
import { type Topic, type TaskNode, progress, topicProgress, slugify } from './tree';
import { downloadBlob } from './download';

const W = 156; // node box width (pt, pre-scale)
const H = 44; // node box height
const HGAP = 56; // horizontal gap between tiers (room for the curved links)
const VGAP = 14; // vertical gap between sibling subtrees

interface Pos {
  x: number;
  y: number;
}

/**
 * Horizontal leaf-cursor tidy layout: depth runs left→right, leaves take
 * consecutive vertical slots, and each parent centers vertically over its children.
 * `x`/`y` are the box's left/top edges.
 */
function layout(tasks: TaskNode[]): { pos: Map<string, Pos>; width: number; height: number } {
  const pos = new Map<string, Pos>();
  let cursor = 0;
  let maxDepth = 0;
  const place = (node: TaskNode, depth: number): Pos => {
    maxDepth = Math.max(maxDepth, depth);
    const x = (depth - 1) * (W + HGAP);
    let y: number;
    if (!node.children.length) {
      y = cursor;
      cursor += H + VGAP;
    } else {
      const kids = node.children.map((c) => place(c, depth + 1));
      y = (kids[0]!.y + kids[kids.length - 1]!.y) / 2;
    }
    const p = { x, y };
    pos.set(node.id, p);
    return p;
  };
  tasks.forEach((t) => place(t, 1));
  return {
    pos,
    width: maxDepth ? (maxDepth - 1) * (W + HGAP) + W : 0,
    height: Math.max(cursor - VGAP, 0),
  };
}

// jsPDF's standard fonts are WinAnsi — keep Latin + common punctuation, replace the rest.
const NON_WINANSI_SRC = '[^\\u0020-\\u007E\\u00A0-\\u00FF\\u2013\\u2014\\u2018\\u2019\\u201C\\u201D\\u2022\\u2026]';
const clean = (s: string) => s.replace(new RegExp(NON_WINANSI_SRC, 'g'), '?');
const hasNonWinAnsi = (s: string) => new RegExp(NON_WINANSI_SRC).test(s);
// With the embedded CJK font almost everything renders; strip only control chars
// (keep newlines — splitTextToSize breaks on them). Glyphs the font lacks show as
// blanks, which beats a wall of '?'.
const cleanUnicode = (s: string) =>
  s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');

// --- CJK support ------------------------------------------------------------------
// jsPDF's built-in fonts are WinAnsi-only, so Chinese/Japanese/Korean text would
// export as '?'. When a topic contains anything beyond WinAnsi, embed Noto Sans
// CJK (OFL-1.1, bundled under public/fonts; Latin + CJK + symbols) instead.
// Fetched lazily and cached across exports, so Latin-only topics never pay the
// ~13 MB cost.
const CJK_FONT = 'FissionCJK';
const CJK_FONT_FILE = 'FissionCJK-Regular.ttf';
let cjkFontB64: string | null = null;
async function loadCjkFontB64(): Promise<string> {
  if (cjkFontB64 !== null) return cjkFontB64;
  const res = await fetch(browser.runtime.getURL(`/fonts/${CJK_FONT_FILE}`));
  if (!res.ok) throw new Error(`CJK font unavailable (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  cjkFontB64 = btoa(bin);
  return cjkFontB64;
}
/** Title + every task text, for the WinAnsi check. */
function topicText(topic: Topic): string {
  let s = topic.title;
  const walk = (ns: TaskNode[]) => {
    for (const n of ns) {
      s += n.text;
      walk(n.children);
    }
  };
  walk(topic.tasks);
  return s;
}

type RGB = [number, number, number];
const GREEN: RGB = [22, 163, 74];
const AMBER: RGB = [217, 119, 6];
const GRAY: RGB = [163, 163, 163];
const INK: RGB = [23, 23, 23];

export async function exportTopicPdf(topic: Topic, targetDoc: Document = document): Promise<void> {
  const cjk = hasNonWinAnsi(topicText(topic));
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4', compress: true });
  const font = cjk ? CJK_FONT : 'helvetica';
  const cleanText = cjk ? cleanUnicode : clean;
  if (cjk) {
    const b64 = await loadCjkFontB64();
    doc.addFileToVFS(CJK_FONT_FILE, b64);
    doc.addFont(CJK_FONT_FILE, CJK_FONT, 'normal');
    doc.addFont(CJK_FONT_FILE, CJK_FONT, 'bold'); // single weight — bold maps to regular
  }
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 36;
  const header = 64;
  const p = topicProgress(topic);

  // Header band
  doc.setFont(font, 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...INK);
  doc.text(cleanText(topic.title), margin, 32);
  doc.setFont(font, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(115, 115, 115);
  doc.text(
    `${p.done}/${p.total} done · ${new Date().toISOString().slice(0, 10)} · Fission`,
    pageW - margin,
    32,
    { align: 'right' },
  );
  doc.setDrawColor(229, 229, 229);
  doc.setLineWidth(0.8);
  doc.line(margin, 44, pageW - margin, 44);

  const { pos, width, height } = layout(topic.tasks);
  if (!topic.tasks.length) {
    doc.setFontSize(11);
    doc.setTextColor(115, 115, 115);
    doc.text('No tasks yet.', pageW / 2, pageH / 2, { align: 'center' });
  } else {
    const availW = pageW - margin * 2;
    const availH = pageH - header - margin;
    const scale = Math.min(1, availW / width, availH / height);
    const ox = margin + (availW - width * scale) / 2;
    const oy = header + (availH - height * scale) / 2;
    const X = (v: number) => ox + v * scale;
    const Y = (v: number) => oy + v * scale;
    const S = (v: number) => v * scale;
    const fs = Math.max(5.5, 9.5 * scale);
    const bfs = Math.max(5, 7.5 * scale);

    // Connectors first (under the boxes): a smooth cubic Bézier from the parent's
    // right edge to each child's left edge — horizontal tangents at both ends, so
    // branches flow in a gentle S-curve rather than a rigid straight elbow.
    doc.setDrawColor(190, 190, 190);
    doc.setLineWidth(Math.max(0.4, scale));
    const drawLinks = (nodes: TaskNode[]) => {
      for (const n of nodes) {
        const a = pos.get(n.id)!;
        for (const c of n.children) {
          const b = pos.get(c.id)!;
          const x1 = X(a.x + W);
          const y1 = Y(a.y + H / 2);
          const x2 = X(b.x);
          const y2 = Y(b.y + H / 2);
          const mx = (x1 + x2) / 2;
          const dy = y2 - y1;
          // Guarantee a visible curve even when parent & child share a height:
          // bow the control points apart so aligned links arc instead of going straight.
          const bow = Math.abs(dy) < 1 ? S(7) : 0;
          // one cubic leg, relative deltas: c1=(mx,y1+bow) c2=(mx,y2-bow) end=(x2,y2)
          doc.lines(
            [[mx - x1, bow, mx - x1, dy - bow, x2 - x1, dy]],
            x1,
            y1,
            [1, 1],
            'S',
            false,
          );
        }
        drawLinks(n.children);
      }
    };
    drawLinks(topic.tasks);

    const drawNodes = (nodes: TaskNode[]) => {
      for (const n of nodes) {
        const a = pos.get(n.id)!;
        const x = X(a.x);
        const y = Y(a.y);
        const w = S(W);
        const h = S(H);
        const pr = progress(n);
        const allDone = pr.total > 0 && pr.done === pr.total;
        const partial = pr.done > 0 && !allDone;
        const border: RGB = n.done || allDone ? GREEN : partial ? AMBER : GRAY;
        const fill: RGB = n.done ? [220, 252, 231] : [255, 255, 255];
        doc.setDrawColor(...border);
        doc.setFillColor(...fill);
        doc.setLineWidth(Math.max(0.5, 1.1 * scale));
        doc.roundedRect(x, y, w, h, S(6), S(6), 'FD');

        // Checkbox icon
        const icx = x + S(16);
        const icy = y + h / 2;
        const r = S(7);
        if (n.done) {
          doc.setFillColor(...GREEN);
          doc.setDrawColor(...GREEN);
          doc.circle(icx, icy, r, 'FD');
          doc.setDrawColor(255, 255, 255);
          doc.setLineWidth(Math.max(0.6, 1.4 * scale));
          doc.line(icx - r * 0.45, icy, icx - r * 0.1, icy + r * 0.4);
          doc.line(icx - r * 0.1, icy + r * 0.4, icx + r * 0.5, icy - r * 0.4);
        } else {
          doc.setFillColor(255, 255, 255);
          doc.setDrawColor(...GRAY);
          doc.setLineWidth(Math.max(0.4, scale));
          doc.circle(icx, icy, r, 'FD');
        }

        // Progress badge (parents only)
        let textRight = x + w - S(8);
        if (pr.total > 0) {
          doc.setFont(font, 'bold');
          doc.setFontSize(bfs);
          doc.setTextColor(...(allDone ? GREEN : partial ? AMBER : GRAY));
          doc.text(`${pr.done}/${pr.total}`, x + w - S(6), y + S(13), { align: 'right' });
          textRight = x + w - S(34);
        }

        // Task text — up to 2 wrapped lines, strikethrough when done
        doc.setFont(font, 'normal');
        doc.setFontSize(fs);
        doc.setTextColor(...(n.done ? ([120, 120, 120] as RGB) : INK));
        const maxW = Math.max(textRight - (x + S(30)), 10);
        let lines = doc.splitTextToSize(cleanText(n.text || '(untitled)'), maxW) as string[];
        if (lines.length > 2) {
          lines = lines.slice(0, 2);
          lines[1] = lines[1]!.replace(/.{0,3}$/, '…');
        }
        const lineH = fs * 1.15;
        const startY = y + h / 2 - ((lines.length - 1) * lineH) / 2 + fs * 0.35;
        lines.forEach((ln, i) => {
          const ty = startY + i * lineH;
          doc.text(ln, x + S(30), ty);
          if (n.done) {
            const tw = doc.getTextWidth(ln);
            doc.setDrawColor(150, 150, 150);
            doc.setLineWidth(Math.max(0.3, 0.7 * scale));
            doc.line(x + S(30), ty - fs * 0.28, x + S(30) + tw, ty - fs * 0.28);
          }
        });
        drawNodes(n.children);
      }
    };
    drawNodes(topic.tasks);
  }

  const date = new Date().toISOString().slice(0, 10);
  downloadBlob(`fission-${slugify(topic.title)}-${date}.pdf`, doc.output('blob'), targetDoc);
}
