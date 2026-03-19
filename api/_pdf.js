// pdf.js — Netlify Function
// Nhận POST JSON { banking, cashSys, cashAct, bookings, staffName, timestamp }
// Trả về PDF binary (application/pdf)

const PDFDocument = require('pdfkit');
const path        = require('path');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const FONT_DIR    = path.join(__dirname, 'fonts');
const FONT_REG    = path.join(FONT_DIR, 'NotoSans-Regular.ttf');
const FONT_BOLD   = path.join(FONT_DIR, 'NotoSans-Bold.ttf');

// ── Màu sắc ──
const C = {
  black:      '#111111',
  headerBg:   '#1a1a1a',
  headerText: '#ffffff',
  rowAlt:     '#f5f5f5',
  rowGreen:   '#d4edda',
  red:        '#c0392b',
  grey:       '#aaaaaa',
  greyLight:  '#e0e0e0',
  mutedText:  '#555555',
};

// ── Helper: vẽ bảng thủ công (pdfkit không có autoTable) ──
function drawTable(doc, { x, y, colWidths, rows, rowHeight = 22, headerRows = 1 }) {
  const tableW = colWidths.reduce((s, w) => s + w, 0);

  rows.forEach((row, ri) => {
    const isHeader  = ri < headerRows;
    const isTotal   = row._total;
    const isAlt     = !isHeader && !isTotal && ri % 2 === 0;

    // Nền
    if (isHeader) {
      doc.rect(x, y, tableW, rowHeight).fill(C.headerBg);
    } else if (isTotal) {
      doc.rect(x, y, tableW, rowHeight).fill(C.rowGreen);
    } else if (isAlt) {
      doc.rect(x, y, tableW, rowHeight).fill(C.rowAlt);
    } else {
      doc.rect(x, y, tableW, rowHeight).fill('#ffffff');
    }

    // Text từng ô
    let cx = x;
    row.cells.forEach((cell, ci) => {
      const cw      = colWidths[ci];
      const align   = cell.align || (ci === 0 ? 'left' : 'left');
      const font    = (isHeader || isTotal || cell.bold) ? 'NotoSans-Bold' : 'NotoSans';
      const color   = isHeader ? C.headerText : (cell.color || C.black);
      const fs      = isHeader ? 8 : (isTotal ? 9.5 : 8.5);
      const padding = 5;

      doc.font(font).fontSize(fs).fillColor(color)
         .text(String(cell.v || ''), cx + padding, y + (rowHeight - fs * 1.2) / 2,
               { width: cw - padding * 2, align, lineBreak: false });
      cx += cw;
    });

    // Đường kẻ ngang dưới mỗi hàng
    doc.moveTo(x, y + rowHeight).lineTo(x + tableW, y + rowHeight)
       .strokeColor(C.grey).lineWidth(0.4).stroke();

    y += rowHeight;
  });

  // Đường viền ngoài + kẻ dọc
  let cx = x;
  colWidths.forEach(cw => {
    doc.moveTo(cx, y - rowHeight * rows.length)
       .lineTo(cx, y)
       .strokeColor(C.grey).lineWidth(0.3).stroke();
    cx += cw;
  });
  // Cột cuối
  doc.moveTo(cx, y - rowHeight * rows.length).lineTo(cx, y)
     .strokeColor(C.grey).lineWidth(0.3).stroke();
  // Viền ngoài đậm hơn
  doc.rect(x, y - rowHeight * rows.length, tableW, rowHeight * rows.length)
     .strokeColor(C.black).lineWidth(0.8).stroke();

  return y; // finalY
}

// ── Sinh PDF ──
function generatePDF({ banking, cashSys, cashAct, bookings, staffName, timestamp }) {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true });
    const chunks = [];

    doc.on('data',  c  => chunks.push(c));
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('NotoSans',      FONT_REG);
    doc.registerFont('NotoSans-Bold', FONT_BOLD);

    const W = 595.28; // A4 width pt
    const margin = 40;
    const innerW = W - margin * 2;
    let y = 36;

    const diff    = cashSys - cashAct;
    const total   = banking + cashAct;
    const now     = timestamp ? new Date(timestamp) : new Date();
    const dateStr = now.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit',
                      day: '2-digit', month: '2-digit', year: 'numeric' });

    // ── Tiêu đề ──
    doc.font('NotoSans-Bold').fontSize(16).fillColor(C.black)
       .text('BÁO CÁO CA LÀM VIỆC', margin, y, { align: 'center', width: innerW });
    y += 26;

    doc.font('NotoSans').fontSize(9).fillColor(C.mutedText)
       .text('THỦY TIÊN PICKLEBALL  —  Nhơn Trạch, Đồng Nai  —  6 sân có mái che',
             margin, y, { align: 'center', width: innerW });
    y += 20;

    // Đường kẻ ngang
    doc.moveTo(margin, y).lineTo(W - margin, y).strokeColor(C.black).lineWidth(1.2).stroke();
    y += 12;

    doc.font('NotoSans').fontSize(9).fillColor('#444444')
       .text(`Thời gian kết ca:  ${dateStr}`, margin, y);
    y += 22;

    // ── Bảng 1: Tổng kết doanh thu ──
    doc.font('NotoSans-Bold').fontSize(10).fillColor(C.black)
       .text('1. TỔNG KẾT DOANH THU CA', margin, y);
    y += 16;

    const fmt = n => Number(n).toLocaleString('vi-VN') + ' đ';
    let diffStr, diffColor;
    if (diff === 0)    { diffStr = '0 đ  (Khớp ✓)';                  diffColor = '#1a7a3c'; }
    else if (diff > 0) { diffStr = `-${fmt(diff)}  (Thiếu)`;          diffColor = C.red; }
    else               { diffStr = `+${fmt(Math.abs(diff))}  (Dư)`;   diffColor = '#1a7a3c'; }

    const revRows = [
      { cells: [{ v: 'Chỉ tiêu' }, { v: 'Số tiền (VNĐ)', align: 'right' }] },
      { cells: [{ v: 'Chuyển khoản / Banking' },         { v: fmt(banking),  align: 'right' }] },
      { cells: [{ v: 'Tiền mặt hệ thống (Cash)' },       { v: fmt(cashSys),  align: 'right' }] },
      { cells: [{ v: 'Tiền mặt thực tế (Đếm được)' },    { v: fmt(cashAct),  align: 'right' }] },
      { cells: [{ v: 'Chênh lệch tiền mặt (HT − TT)' }, { v: diffStr, align: 'right', color: diffColor }] },
      { cells: [{ v: 'TỔNG DOANH THU CA', bold: true },  { v: fmt(total), align: 'right', bold: true }], _total: true },
    ];

    y = drawTable(doc, {
      x: margin, y,
      colWidths: [innerW * 0.62, innerW * 0.38],
      rows: revRows, rowHeight: 22, headerRows: 1
    });
    y += 16;

    // ── Bảng 2: Chi tiết hóa đơn ──
    doc.font('NotoSans-Bold').fontSize(10).fillColor(C.black)
       .text('2. CHI TIẾT HÓA ĐƠN TRONG CA', margin, y);
    y += 14;

    const colW = [52, 62, 55, 50, 44, 34, 20, 58, 24, 26]; // tổng ~425pt ~ innerW

    const headerRow = { cells: [
      { v: 'Mã đơn' }, { v: 'Tên KH' }, { v: 'SĐT' }, { v: 'Ngày' },
      { v: 'Giờ' }, { v: 'Sân' }, { v: 'SN' },
      { v: 'Tổng tiền', align: 'right' }, { v: 'T.toán', align: 'center' }, { v: 'T.thái', align: 'center' }
    ]};

    const payLabel  = p  => p === 'banking' ? 'CK' : 'TM';
    const statLabel = s  => s === 'confirmed' ? 'XN' : s === 'cancelled' ? 'Hủy' : 'Chờ';

    const detailRows = [headerRow];
    if (bookings && bookings.length > 0) {
      bookings.forEach(b => {
        detailRows.push({ cells: [
          { v: b.id },
          { v: b.name },
          { v: b.phone },
          { v: b.date },
          { v: `${b.startHour} (${b.duration}h)` },
          { v: b.court },
          { v: String(b.players || '') },
          { v: fmt(b.total), align: 'right' },
          { v: payLabel(b.payment),  align: 'center' },
          { v: statLabel(b.status),  align: 'center' },
        ]});
      });
    } else {
      detailRows.push({ cells: [
        { v: '(Không có hóa đơn)' }, ...Array(9).fill({ v: '' })
      ]});
    }

    y = drawTable(doc, {
      x: margin, y,
      colWidths: colW,
      rows: detailRows, rowHeight: 20, headerRows: 1
    });
    y += 20;

    // ── Footer: đường kẻ + người đứng ca ──
    doc.moveTo(margin, y).lineTo(W - margin, y)
       .strokeColor(C.greyLight).lineWidth(0.8).stroke();
    y += 10;

    doc.font('NotoSans-Bold').fontSize(11).fillColor(C.black)
       .text(`NGƯỜI ĐỨNG CA:  ${String(staffName || '').toUpperCase()}`, margin, y);
    y += 16;

    doc.font('NotoSans').fontSize(8.5).fillColor('#666666')
       .text(`Xuất lúc: ${dateStr}`, margin, y);

    doc.end();
  });
}

// ── Handler ──
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  }

  // Kiểm tra JWT (dùng lại secret từ env)
  const auth = (event.headers.authorization || '').replace('Bearer ', '');
  if (!auth) return { statusCode: 401, headers: CORS, body: 'Unauthorized' };

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS, body: 'Invalid JSON' };
  }

  try {
    const pdfBuffer = await generatePDF(body);
    return {
      statusCode: 200,
      headers: {
        ...CORS,
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="bao-cao-ca-${Date.now()}.pdf"`,
        'Content-Length':      String(pdfBuffer.length),
      },
      body:            pdfBuffer.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error('PDF error:', err);
    return { statusCode: 500, headers: CORS, body: 'PDF generation failed: ' + err.message };
  }
};
