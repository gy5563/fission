// Visual tree export: a tidy top-down diagram (boxes + elbow connectors),
// checkmarks for done tasks, progress badges on parents. Vector PDF via jsPDF.
import { jsPDF } from 'jspdf';
import { type Topic, type TaskNode, progress, topicProgress, slugify } from './tree';
import { downloadBlob } from './download';

const W = 156; // node box width (pt, pre-scale)
const H = 44; // node box height
const GX = 16; // horizontal gap between sibling subtrees
const GY = 40; // vertical gap between tiers

interface Pos {
  x: number;
  y: number;
}

/** Leaf-cursor tidy layout: leaves take consecutive slots, parents center over children. */
function layout(tasks: TaskNode[]): { pos: Map<string, Pos>; width: number; height: number } {
  const pos = new Map<string, Pos>();
  let cursor = 0;
  let maxDepth = 0;
  const place = (node: TaskNode, depth: number): Pos => {
    maxDepth = Math.max(maxDepth, depth);
    const y = (depth - 1) * (H + GY);
    let x: number;
    if (!node.children.length) {
      x = cursor;
      cursor += W + GX;
    } else {
      const kids = node.children.map((c) => place(c, depth + 1));
      x = (kids[0]!.x + kids[kids.length - 1]!.x) / 2;
    }
    const p = { x, y };
    pos.set(node.id, p);
    return p;
  };
  tasks.forEach((t) => place(t, 1));
  return {
    pos,
    width: Math.max(cursor - GX, 0),
    height: maxDepth ? (maxDepth - 1) * (H + GY) + H : 0,
  };
}

// jsPDF's standard fonts are WinAnsi — keep Latin + common punctuation, replace the rest.
const clean = (s: string) =>
  s.replace(/[^\u0020-\u007E\u00A0-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026]/g, '?');

type RGB = [number, number, number];
const GREEN: RGB = [22, 163, 74];
const AMBER: RGB = [217, 119, 6];
const GRAY: RGB = [163, 163, 163];
const INK: RGB = [23, 23, 23];

export function exportTopicPdf(topic: Topic): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4', compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 36;
  const header = 64;
  const p = topicProgress(topic);

  // Header band
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...INK);
  doc.text(clean(topic.title), margin, 32);
  doc.setFont('helvetica', 'normal');
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

    // Connectors first (under the boxes): parent bottom → elbow → child top.
    doc.setDrawColor(190, 190, 190);
    doc.setLineWidth(Math.max(0.4, scale));
    const drawLinks = (nodes: TaskNode[]) => {
      for (const n of nodes) {
        const a = pos.get(n.id)!;
        for (const c of n.children) {
          const b = pos.get(c.id)!;
          const px = X(a.x + W / 2);
          const py = Y(a.y + H);
          const cx = X(b.x + W / 2);
          const cy = Y(b.y);
          const my = Y(a.y + H + GY / 2);
          doc.line(px, py, px, my);
          doc.line(px, my, cx, my);
          doc.line(cx, my, cx, cy);
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
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(bfs);
          doc.setTextColor(...(allDone ? GREEN : partial ? AMBER : GRAY));
          doc.text(`${pr.done}/${pr.total}`, x + w - S(6), y + S(13), { align: 'right' });
          textRight = x + w - S(34);
        }

        // Task text — up to 2 wrapped lines, strikethrough when done
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(fs);
        doc.setTextColor(...(n.done ? ([120, 120, 120] as RGB) : INK));
        const maxW = Math.max(textRight - (x + S(30)), 10);
        let lines = doc.splitTextToSize(clean(n.text || '(untitled)'), maxW) as string[];
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
  downloadBlob(`fission-${slugify(topic.title)}-${date}.pdf`, doc.output('blob'));
}
