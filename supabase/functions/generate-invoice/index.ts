import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://swayphics.co.za",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BRAND = rgb(0 / 255, 32 / 255, 150 / 255);
const DARK = rgb(8 / 255, 21 / 255, 51 / 255);
const MUTED = rgb(86 / 255, 98 / 255, 122 / 255);
const LIGHT = rgb(247 / 255, 250 / 255, 255 / 255);
const BORDER = rgb(224 / 255, 230 / 255, 240 / 255);

interface InvoiceRequest {
  invoice_id?: string;
  action?: "pdf" | "send";
}

interface LineItem {
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

function money(value: number) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function shortDate(value: string | null | undefined) {
  if (!value) return "—";

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return parsed.toLocaleDateString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function wrapText(
  text: string,
  font: any,
  size: number,
  maxWidth: number,
) {
  const words = String(text || "").split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current
      ? current + " " + word
      : word;

    if (
      font.widthOfTextAtSize(
        candidate,
        size,
      ) <= maxWidth
    ) {
      current = candidate;
    } else if (current) {
      lines.push(current);
      current = word;
    } else {
      lines.push(word);
      current = "";
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.length ? lines : [""];
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;

  for (
    let index = 0;
    index < bytes.length;
    index += chunkSize
  ) {
    binary += String.fromCharCode(
      ...bytes.subarray(
        index,
        Math.min(
          index + chunkSize,
          bytes.length,
        ),
      ),
    );
  }

  return btoa(binary);
}

async function loadLogo() {
  try {
    const response = await fetch(
      "https://swayphics.co.za/swayphics-logo.png",
    );

    if (!response.ok) {
      return null;
    }

    return new Uint8Array(
      await response.arrayBuffer(),
    );
  } catch {
    return null;
  }
}

async function buildPdf(
  invoice: any,
  items: LineItem[],
  settings: any,
) {
  const pdfDoc = await PDFDocument.create();
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 46;
  const contentWidth = pageWidth - margin * 2;
  const charcoal = rgb(38 / 255, 45 / 255, 56 / 255);
  const accent = rgb(1 / 255, 82 / 255, 244 / 255);
  const paleBlue = rgb(241 / 255, 246 / 255, 255 / 255);
  const soft = rgb(250 / 255, 251 / 255, 253 / 255);
  const white = rgb(1, 1, 1);

  const logoBytes = await loadLogo();
  let logo = null;
  if (logoBytes) {
    try {
      logo = await pdfDoc.embedPng(logoBytes);
    } catch {
      logo = null;
    }
  }

  const invoiceNumber = String(invoice.invoice_number || "INVOICE");
  const businessName = String(settings.business_name || "Swayphics");
  const businessEmail = String(settings.email || "info@swayphics.co.za");
  const amountPaid = Number(invoice.amount_paid || 0);
  const invoiceTotal = Number(invoice.total || 0);
  const amountOutstanding = invoice.amount_outstanding == null
    ? Math.max(invoiceTotal - amountPaid, 0)
    : Number(invoice.amount_outstanding);
  const payableAmount = invoice.status === "paid"
    ? (amountPaid || invoiceTotal)
    : invoice.status === "cancelled"
      ? invoiceTotal
      : amountOutstanding;
  const totalLabel = invoice.status === "paid"
    ? "TOTAL PAID"
    : invoice.status === "partially paid"
      ? "BALANCE DUE"
      : invoice.status === "overdue"
        ? "OVERDUE BALANCE"
        : invoice.status === "cancelled"
          ? "INVOICE TOTAL"
          : "TOTAL DUE";

  function drawRight(
    targetPage: any,
    value: unknown,
    right: number,
    y: number,
    size: number,
    font: any,
    color: any,
  ) {
    const text = String(value ?? "");
    targetPage.drawText(text, {
      x: right - font.widthOfTextAtSize(text, size),
      y,
      size,
      font,
      color,
    });
  }

  function drawWrapped(
    targetPage: any,
    value: unknown,
    x: number,
    y: number,
    maxWidth: number,
    size: number,
    font: any,
    color: any,
    lineHeight = 12,
  ) {
    const lines = wrapText(String(value ?? ""), font, size, maxWidth);
    lines.forEach((line, index) => {
      targetPage.drawText(line, {
        x,
        y: y - index * lineHeight,
        size,
        font,
        color,
      });
    });
    return y - lines.length * lineHeight;
  }

  function drawRule(targetPage: any, y: number, color = BORDER, thickness = 0.7) {
    targetPage.drawLine({
      start: { x: margin, y },
      end: { x: pageWidth - margin, y },
      thickness,
      color,
    });
  }

  function drawTopBrand(targetPage: any, title: string, continued = false) {
    targetPage.drawRectangle({
      x: 0,
      y: pageHeight - 5,
      width: pageWidth,
      height: 5,
      color: accent,
    });

    if (continued || !logo) {
      targetPage.drawText(title, {
        x: margin,
        y: continued ? pageHeight - 58 : pageHeight - 80,
        size: continued ? 12 : 22,
        font: bold,
        color: BRAND,
        characterSpacing: continued ? 0.6 : -0.5,
      });
    }

    if (continued) {
      drawRight(
        targetPage,
        "INVOICE " + invoiceNumber,
        pageWidth - margin,
        pageHeight - 58,
        8,
        bold,
        MUTED,
      );
    }
  }

  function drawTableHeader(targetPage: any, topY: number) {
    const headerHeight = 26;
    targetPage.drawRectangle({
      x: margin,
      y: topY - headerHeight,
      width: contentWidth,
      height: headerHeight,
      color: charcoal,
    });
    targetPage.drawRectangle({
      x: margin,
      y: topY - 2,
      width: contentWidth,
      height: 2,
      color: accent,
    });

    targetPage.drawText("SERVICE / DESCRIPTION", {
      x: margin + 12,
      y: topY - 17,
      size: 7,
      font: bold,
      color: white,
      characterSpacing: 0.55,
    });
    drawRight(targetPage, "QTY", margin + 354, topY - 17, 7, bold, white);
    drawRight(targetPage, "UNIT PRICE", margin + 438, topY - 17, 7, bold, white);
    drawRight(targetPage, "AMOUNT", pageWidth - margin - 12, topY - 17, 7, bold, white);
    return topY - headerHeight - 12;
  }

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  drawTopBrand(page, "SWAYPHICS");

  if (logo) {
    const maxWidth = 118;
    const maxHeight = 40;
    const scale = Math.min(maxWidth / logo.width, maxHeight / logo.height);
    page.drawImage(logo, {
      x: margin,
      y: pageHeight - 101,
      width: logo.width * scale,
      height: logo.height * scale,
    });
  }

  page.drawText("EMPOWERING THROUGH DESIGN", {
    x: margin,
    y: pageHeight - 112,
    size: 6.5,
    font: bold,
    color: MUTED,
    characterSpacing: 1.05,
  });

  drawRight(page, "INVOICE", pageWidth - margin, pageHeight - 66, 24, bold, BRAND);
  drawRight(page, invoiceNumber, pageWidth - margin, pageHeight - 86, 9, bold, DARK);
  drawRight(page, "CREATIVE SERVICES", pageWidth - margin, pageHeight - 101, 6.5, regular, MUTED);

  drawRule(page, pageHeight - 133, BORDER, 0.9);

  const metaY = pageHeight - 207;
  const metaGap = 10;
  const metaWidth = (contentWidth - metaGap * 2) / 3;
  const meta = [
    { label: "INVOICE NUMBER", value: invoiceNumber },
    { label: "ISSUE DATE", value: shortDate(invoice.issue_date) },
    { label: "PAYMENT DUE", value: shortDate(invoice.due_date) },
  ];

  meta.forEach((entry, index) => {
    const x = margin + index * (metaWidth + metaGap);
    page.drawRectangle({
      x,
      y: metaY,
      width: metaWidth,
      height: 56,
      color: soft,
      borderColor: BORDER,
      borderWidth: 0.65,
    });
    page.drawRectangle({
      x,
      y: metaY + 53,
      width: metaWidth,
      height: 3,
      color: index === 2 ? accent : BRAND,
    });
    page.drawText(entry.label, {
      x: x + 11,
      y: metaY + 36,
      size: 6.2,
      font: bold,
      color: MUTED,
      characterSpacing: 0.7,
    });
    page.drawText(String(entry.value), {
      x: x + 11,
      y: metaY + 15,
      size: 9,
      font: bold,
      color: DARK,
    });
  });

  const infoTop = metaY - 29;
  page.drawText("BILLED TO", {
    x: margin,
    y: infoTop,
    size: 7,
    font: bold,
    color: BRAND,
    characterSpacing: 1,
  });
  page.drawText("ISSUED BY", {
    x: margin + 268,
    y: infoTop,
    size: 7,
    font: bold,
    color: BRAND,
    characterSpacing: 1,
  });

  const clientName = String(invoice.client?.business_name || "Client");
  page.drawText(clientName, {
    x: margin,
    y: infoTop - 22,
    size: 12,
    font: bold,
    color: DARK,
  });

  let clientLineY = infoTop - 37;
  if (invoice.client?.contact_name) {
    clientLineY = drawWrapped(
      page,
      invoice.client.contact_name,
      margin,
      clientLineY,
      235,
      8,
      regular,
      MUTED,
      11,
    );
  }
  if (invoice.client?.email) {
    drawWrapped(
      page,
      invoice.client.email,
      margin,
      clientLineY,
      235,
      8,
      regular,
      MUTED,
      11,
    );
  }

  page.drawText(businessName, {
    x: margin + 268,
    y: infoTop - 22,
    size: 12,
    font: bold,
    color: DARK,
  });
  page.drawText(businessEmail, {
    x: margin + 268,
    y: infoTop - 37,
    size: 8,
    font: regular,
    color: MUTED,
  });
  page.drawText("swayphics.co.za", {
    x: margin + 268,
    y: infoTop - 50,
    size: 8,
    font: regular,
    color: MUTED,
  });

  y = infoTop - 82;
  page.drawText("SERVICE BREAKDOWN", {
    x: margin,
    y,
    size: 8,
    font: bold,
    color: DARK,
    characterSpacing: 0.75,
  });
  drawRight(page, "ITEMISED SUMMARY", pageWidth - margin, y, 6.5, bold, MUTED);
  y = drawTableHeader(page, y - 13);

  function startContinuation(title: string) {
    page = pdfDoc.addPage([pageWidth, pageHeight]);
    drawTopBrand(page, title, true);
    drawRule(page, pageHeight - 82, BORDER, 0.8);
    y = pageHeight - 113;
  }

  let rowIndex = 0;
  for (const item of items) {
    const descriptionLines = wrapText(
      String(item.description || "Service"),
      regular,
      8.5,
      268,
    );
    const rowHeight = Math.max(37, descriptionLines.length * 11 + 19);

    if (y - rowHeight < 108) {
      startContinuation("SERVICE BREAKDOWN / CONTINUED");
      y = drawTableHeader(page, y - 4);
    }

    if (rowIndex % 2 === 1) {
      page.drawRectangle({
        x: margin,
        y: y - rowHeight + 5,
        width: contentWidth,
        height: rowHeight,
        color: soft,
      });
    }

    descriptionLines.forEach((line, index) => {
      page.drawText(line, {
        x: margin + 12,
        y: y - 13 - index * 11,
        size: 8.5,
        font: regular,
        color: DARK,
      });
    });

    drawRight(page, item.quantity, margin + 354, y - 14, 8, regular, DARK);
    drawRight(page, money(item.unit_price), margin + 438, y - 14, 8, regular, MUTED);
    drawRight(page, money(item.line_total), pageWidth - margin - 12, y - 14, 8, bold, DARK);

    page.drawLine({
      start: { x: margin, y: y - rowHeight + 3 },
      end: { x: pageWidth - margin, y: y - rowHeight + 3 },
      thickness: 0.5,
      color: BORDER,
    });

    y -= rowHeight;
    rowIndex += 1;
  }

  const summaryRows =
    1 +
    (Number(invoice.discount || 0) > 0 ? 1 : 0) +
    (Number(invoice.vat_amount || 0) > 0 ? 1 : 0) +
    (amountPaid > 0 && invoice.status !== "paid" ? 1 : 0);
  const summaryHeight = summaryRows * 18 + 66;

  if (y - summaryHeight < 108) {
    startContinuation("INVOICE SUMMARY");
  }

  y -= 19;
  const summaryX = pageWidth - margin - 215;
  const summaryValueRight = pageWidth - margin - 12;

  function drawSummaryRow(label: string, value: string) {
    page.drawText(label, {
      x: summaryX,
      y,
      size: 8,
      font: regular,
      color: MUTED,
    });
    drawRight(page, value, summaryValueRight, y, 8, bold, DARK);
    y -= 18;
  }

  drawSummaryRow("Subtotal", money(invoice.subtotal));

  if (Number(invoice.discount || 0) > 0) {
    drawSummaryRow("Discount", "-" + money(invoice.discount));
  }

  if (Number(invoice.vat_amount || 0) > 0) {
    drawSummaryRow("VAT (" + Number(invoice.vat_rate || 0) + "%)", money(invoice.vat_amount));
  }

  if (amountPaid > 0 && invoice.status !== "paid") {
    drawSummaryRow("Paid to date", "-" + money(amountPaid));
  }

  y -= 2;
  const totalBoxX = summaryX - 12;
  const totalBoxWidth = pageWidth - margin - totalBoxX;
  const totalBoxY = y - 40;
  page.drawRectangle({
    x: totalBoxX,
    y: totalBoxY,
    width: totalBoxWidth,
    height: 48,
    color: charcoal,
  });
  page.drawRectangle({
    x: totalBoxX,
    y: totalBoxY,
    width: 4,
    height: 48,
    color: accent,
  });

  page.drawText(totalLabel, {
    x: totalBoxX + 14,
    y: totalBoxY + 27,
    size: 7,
    font: bold,
    color: rgb(210 / 255, 220 / 255, 235 / 255),
    characterSpacing: 0.8,
  });
  drawRight(
    page,
    money(payableAmount),
    totalBoxX + totalBoxWidth - 14,
    totalBoxY + 15,
    15,
    bold,
    white,
  );

  y = totalBoxY - 29;

  const notes = String(invoice.notes || "Thank you for choosing Swayphics.");
  const noteLines = wrapText(notes, regular, 8, contentWidth - 26);
  const noteHeight = Math.max(54, noteLines.length * 11 + 31);
  if (y - noteHeight < 92) {
    startContinuation("ADDITIONAL INFORMATION");
  }

  page.drawText("PROJECT NOTES", {
    x: margin,
    y,
    size: 7,
    font: bold,
    color: BRAND,
    characterSpacing: 0.85,
  });
  y -= 15;

  const notesBoxHeight = Math.max(34, noteLines.length * 11 + 17);
  page.drawRectangle({
    x: margin,
    y: y - notesBoxHeight + 4,
    width: contentWidth,
    height: notesBoxHeight,
    color: soft,
    borderColor: BORDER,
    borderWidth: 0.6,
  });
  noteLines.forEach((line, index) => {
    page.drawText(line, {
      x: margin + 12,
      y: y - 11 - index * 11,
      size: 8,
      font: regular,
      color: MUTED,
    });
  });
  y -= notesBoxHeight + 19;

  const hasPaymentDetails = Boolean(
    settings.payment_instructions ||
    settings.bank_name ||
    settings.account_name ||
    settings.account_number ||
    settings.account_type ||
    settings.branch_code ||
    settings.swift_bic
  );

  if (hasPaymentDetails) {
    const paymentLines = [
      settings.bank_name ? "Bank: " + settings.bank_name : "",
      settings.account_name ? "Account holder: " + settings.account_name : "",
      settings.account_type ? "Account type: " + settings.account_type : "",
      settings.branch_code ? "Branch code: " + settings.branch_code : "",
      settings.swift_bic ? "SWIFT / BIC: " + settings.swift_bic : "",
      settings.payment_instructions ? String(settings.payment_instructions) : "",
    ].filter(Boolean).flatMap((line) => wrapText(String(line), regular, 7.5, contentWidth - 28));

    const paymentHeight = Math.max(
      72,
      paymentLines.length * 10 + (settings.account_number ? 70 : 42),
    );

    if (y - paymentHeight < 88) {
      startContinuation("PAYMENT INFORMATION");
    }

    page.drawRectangle({
      x: margin,
      y: y - paymentHeight + 5,
      width: contentWidth,
      height: paymentHeight,
      color: paleBlue,
      borderColor: BORDER,
      borderWidth: 0.65,
    });
    page.drawRectangle({
      x: margin,
      y: y - paymentHeight + 5,
      width: 3,
      height: paymentHeight,
      color: accent,
    });
    page.drawText("PAYMENT INFORMATION", {
      x: margin + 13,
      y: y - 16,
      size: 7,
      font: bold,
      color: BRAND,
      characterSpacing: 0.8,
    });

    let paymentY = y - 32;
    for (const line of paymentLines) {
      page.drawText(line, {
        x: margin + 13,
        y: paymentY,
        size: 7.5,
        font: regular,
        color: DARK,
      });
      paymentY -= 10;
    }

    if (settings.account_number) {
      page.drawText("ACCOUNT NUMBER", {
        x: margin + 13,
        y: paymentY - 1,
        size: 6.2,
        font: bold,
        color: MUTED,
        characterSpacing: 0.7,
      });
      page.drawText(String(settings.account_number), {
        x: margin + 13,
        y: paymentY - 17,
        size: 10,
        font: bold,
        color: DARK,
        characterSpacing: 0.8,
      });
    }

    y -= paymentHeight + 18;
  }

  const pages = pdfDoc.getPages();
  pages.forEach((targetPage, index) => {
    targetPage.drawLine({
      start: { x: margin, y: 47 },
      end: { x: pageWidth - margin, y: 47 },
      thickness: 0.6,
      color: BORDER,
    });

    targetPage.drawText("SWAYPHICS  /  EMPOWERING THROUGH DESIGN", {
      x: margin,
      y: 29,
      size: 6.2,
      font: bold,
      color: MUTED,
      characterSpacing: 0.35,
    });

    drawRight(
      targetPage,
      "SWAYPHICS.CO.ZA     " + (index + 1) + " / " + pages.length,
      pageWidth - margin,
      29,
      6.2,
      regular,
      MUTED,
    );
  });

  return await pdfDoc.save();
}

function emailHtml(
  invoice: any,
  items: LineItem[],
  settings: any,
) {
  const rows = items.map((item) => [
    "<tr>",
    '<td style="padding:15px 12px;border-bottom:1px solid #E8ECF3;color:#26303C;font-size:13px;line-height:1.55;">' + escapeHtml(item.description) + "</td>",
    '<td style="padding:15px 8px;border-bottom:1px solid #E8ECF3;text-align:center;color:#687487;font-size:12px;">' + escapeHtml(item.quantity) + "</td>",
    '<td style="padding:15px 10px;border-bottom:1px solid #E8ECF3;text-align:right;color:#687487;font-size:12px;white-space:nowrap;">' + escapeHtml(money(item.unit_price)) + "</td>",
    '<td style="padding:15px 12px;border-bottom:1px solid #E8ECF3;text-align:right;color:#26303C;font-size:12px;font-weight:700;white-space:nowrap;">' + escapeHtml(money(item.line_total)) + "</td>",
    "</tr>",
  ].join("")).join("");

  const amountPaid = Number(invoice.amount_paid || 0);
  const invoiceTotal = Number(invoice.total || 0);
  const amountOutstanding = invoice.amount_outstanding == null
    ? Math.max(invoiceTotal - amountPaid, 0)
    : Number(invoice.amount_outstanding);
  const payableAmount = invoice.status === "paid"
    ? (amountPaid || invoiceTotal)
    : invoice.status === "cancelled"
      ? invoiceTotal
      : amountOutstanding;
  const totalLabel = invoice.status === "paid"
    ? "TOTAL PAID"
    : invoice.status === "partially paid"
      ? "BALANCE DUE"
      : invoice.status === "overdue"
        ? "OVERDUE BALANCE"
        : invoice.status === "cancelled"
          ? "INVOICE TOTAL"
          : "TOTAL DUE";

  const bankingDetails = [
    settings.bank_name ? "Bank: " + escapeHtml(settings.bank_name) : "",
    settings.account_name ? "Account holder: " + escapeHtml(settings.account_name) : "",
    settings.account_type ? "Account type: " + escapeHtml(settings.account_type) : "",
    settings.branch_code ? "Branch code: " + escapeHtml(settings.branch_code) : "",
    settings.swift_bic ? "SWIFT / BIC: " + escapeHtml(settings.swift_bic) : "",
  ].filter(Boolean);

  const hasBankingDetails = Boolean(
    bankingDetails.length || settings.account_number
  );
  const clientName =
    invoice.client?.contact_name ||
    invoice.client?.business_name ||
    "there";

  return [
    "<!doctype html>",
    '<html><body style="margin:0;padding:0;background:#F3F5F9;font-family:Arial,Helvetica,sans-serif;color:#26303C;">',
    '<div style="max-width:700px;margin:0 auto;padding:34px 16px;">',
    '<div style="overflow:hidden;background:#FFFFFF;border:1px solid #E1E6EF;border-radius:8px;">',
    '<div style="height:4px;background:#0152F4;font-size:0;line-height:0;">&nbsp;</div>',
    '<div style="padding:28px 34px 26px;background:#202B3A;color:#FFFFFF;">',
    '<div style="font-size:22px;font-weight:800;letter-spacing:.035em;">SWAYPHICS</div>',
    '<div style="margin-top:7px;font-size:9px;font-weight:700;letter-spacing:.19em;color:#C5D0E0;">EMPOWERING THROUGH DESIGN</div>',
    "</div>",
    '<div style="padding:34px;">',
    '<div style="font-size:10px;font-weight:700;letter-spacing:.16em;color:#0152F4;">INVOICE ' + escapeHtml(invoice.invoice_number) + "</div>",
    '<h1 style="margin:10px 0 8px;color:#202B3A;font-size:27px;line-height:1.2;letter-spacing:-.035em;">Your invoice is ready.</h1>',
    '<p style="margin:0;color:#687487;font-size:14px;line-height:1.75;">Hello ' + escapeHtml(clientName) + ',<br><br>Please find your Swayphics invoice attached. The breakdown below gives you a clear view of the services, pricing and payment date.</p>',
    '<table role="presentation" style="width:100%;margin:27px 0 30px;border-collapse:separate;border-spacing:8px 0;"><tr>',
    '<td style="width:33.33%;padding:14px 13px;background:#F7F9FC;border:1px solid #E7EBF2;vertical-align:top;"><div style="font-size:9px;font-weight:700;letter-spacing:.1em;color:#778397;">INVOICE NUMBER</div><div style="margin-top:8px;font-size:12px;font-weight:700;color:#26303C;">' + escapeHtml(invoice.invoice_number) + "</div></td>",
    '<td style="width:33.33%;padding:14px 13px;background:#F7F9FC;border:1px solid #E7EBF2;vertical-align:top;"><div style="font-size:9px;font-weight:700;letter-spacing:.1em;color:#778397;">ISSUED</div><div style="margin-top:8px;font-size:12px;font-weight:700;color:#26303C;">' + escapeHtml(shortDate(invoice.issue_date)) + "</div></td>",
    '<td style="width:33.33%;padding:14px 13px;background:#F7F9FC;border:1px solid #E7EBF2;vertical-align:top;"><div style="font-size:9px;font-weight:700;letter-spacing:.1em;color:#778397;">PAYMENT DUE</div><div style="margin-top:8px;font-size:12px;font-weight:700;color:#26303C;">' + escapeHtml(shortDate(invoice.due_date)) + "</div></td>",
    "</tr></table>",
    '<div style="margin-bottom:12px;font-size:10px;font-weight:700;letter-spacing:.14em;color:#26303C;">SERVICE BREAKDOWN</div>',
    '<table role="presentation" style="width:100%;border-collapse:collapse;"><thead><tr style="background:#26303C;">',
    '<th style="padding:12px;text-align:left;font-size:9px;letter-spacing:.08em;color:#FFFFFF;">SERVICE / DESCRIPTION</th>',
    '<th style="padding:12px 8px;text-align:center;font-size:9px;letter-spacing:.08em;color:#FFFFFF;">QTY</th>',
    '<th style="padding:12px 10px;text-align:right;font-size:9px;letter-spacing:.08em;color:#FFFFFF;">UNIT PRICE</th>',
    '<th style="padding:12px;text-align:right;font-size:9px;letter-spacing:.08em;color:#FFFFFF;">AMOUNT</th>',
    "</tr></thead><tbody>" + rows + "</tbody></table>",
    '<table role="presentation" style="width:100%;margin-top:22px;border-collapse:collapse;">',
    '<tr><td style="padding:5px 0;color:#778397;font-size:12px;">Subtotal</td><td style="padding:5px 0;text-align:right;color:#26303C;font-size:12px;font-weight:700;">' + escapeHtml(money(invoice.subtotal)) + "</td></tr>",
    Number(invoice.discount || 0) > 0 ? '<tr><td style="padding:5px 0;color:#778397;font-size:12px;">Discount</td><td style="padding:5px 0;text-align:right;color:#26303C;font-size:12px;font-weight:700;">-' + escapeHtml(money(invoice.discount)) + "</td></tr>" : "",
    Number(invoice.vat_amount || 0) > 0 ? '<tr><td style="padding:5px 0;color:#778397;font-size:12px;">VAT (' + escapeHtml(Number(invoice.vat_rate || 0)) + '%)</td><td style="padding:5px 0;text-align:right;color:#26303C;font-size:12px;font-weight:700;">' + escapeHtml(money(invoice.vat_amount)) + "</td></tr>" : "",
    amountPaid > 0 && invoice.status !== "paid" ? '<tr><td style="padding:5px 0;color:#778397;font-size:12px;">Paid to date</td><td style="padding:5px 0;text-align:right;color:#26303C;font-size:12px;font-weight:700;">-' + escapeHtml(money(amountPaid)) + "</td></tr>" : "",
    "</table>",
    '<div style="margin-top:15px;padding:19px 21px;background:#202B3A;border-left:4px solid #0152F4;"><table role="presentation" style="width:100%;border-collapse:collapse;"><tr>',
    '<td style="color:#D3DCE8;font-size:10px;font-weight:700;letter-spacing:.14em;">' + totalLabel + "</td>",
    '<td style="text-align:right;color:#FFFFFF;font-size:23px;font-weight:800;letter-spacing:-.025em;white-space:nowrap;">' + escapeHtml(money(payableAmount)) + "</td>",
    "</tr></table></div>",
    invoice.notes ? '<div style="margin-top:25px;padding:17px 19px;background:#F7F9FC;border:1px solid #E7EBF2;"><div style="margin-bottom:7px;font-size:9px;font-weight:700;letter-spacing:.13em;color:#0152F4;">PROJECT NOTES</div><div style="font-size:12px;line-height:1.7;color:#687487;">' + escapeHtml(invoice.notes) + "</div></div>" : "",
    settings.payment_instructions ? '<div style="margin-top:24px;font-size:12px;line-height:1.75;color:#687487;"><strong style="color:#26303C;">Payment instructions</strong><br>' + escapeHtml(settings.payment_instructions) + "</div>" : "",
    hasBankingDetails ? '<div style="margin-top:18px;padding:19px 20px;background:#F1F6FF;border:1px solid #DCE6F7;"><div style="margin-bottom:11px;font-size:10px;font-weight:700;letter-spacing:.13em;color:#002096;">BANKING DETAILS</div><div style="font-size:12px;line-height:1.85;color:#687487;">' + bankingDetails.join("<br>") + "</div>" + (settings.account_number ? '<div style="margin-top:14px;padding:13px 15px;background:#FFFFFF;border:1px solid #DCE6F7;"><div style="font-size:9px;font-weight:700;letter-spacing:.13em;color:#0152F4;">ACCOUNT NUMBER</div><div style="margin-top:7px;font-family:Consolas,Menlo,monospace;font-size:17px;font-weight:700;letter-spacing:.07em;color:#202B3A;user-select:text;-webkit-user-select:text;">' + escapeHtml(String(settings.account_number)) + "</div></div>" : "") + "</div>" : "",
    '<p style="margin:27px 0 0;color:#687487;font-size:12px;line-height:1.75;">Thank you for choosing Swayphics. We appreciate the opportunity to work with your business.</p>',
    '<p style="margin:16px 0 0;color:#26303C;font-size:12px;line-height:1.7;font-weight:700;">Kind regards,<br>Swayphics</p>',
    "</div>",
    '<div style="padding:22px 34px;background:#F7F9FC;border-top:1px solid #E7EBF2;font-size:10px;line-height:1.8;color:#778397;">',
    "<strong style=\"color:#26303C;\">" + escapeHtml(settings.business_name || "Swayphics") + "</strong><br>",
    escapeHtml(settings.email || "info@swayphics.co.za") + ' · <a href="https://swayphics.co.za" style="color:#0152F4;text-decoration:none;">swayphics.co.za</a><br>',
    '<a href="https://swayphics.co.za/privacy-policy/" style="color:#778397;text-decoration:underline;">Privacy Policy</a><span style="padding:0 6px;color:#B4BFCE;">·</span><a href="https://swayphics.co.za/terms-and-conditions/" style="color:#778397;text-decoration:underline;">Terms &amp; Conditions</a><br>',
    '<span style="color:#9AA5B4;">© ' + new Date().getFullYear() + ' Swayphics. All rights reserved.</span><br>',
    '<span style="color:#9AA5B4;">This email and its attachments are intended only for the addressed recipient. If received in error, please notify the sender and delete it.</span>',
    "</div></div></div></body></html>",
  ].join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return Response.json(
      { error: "Method not allowed." },
      {
        status: 405,
        headers: corsHeaders,
      },
    );
  }

  try {
    const authHeader =
      req.headers.get("Authorization") ||
      req.headers.get("authorization");

    const accessToken =
      authHeader?.replace(
        /^Bearer\s+/i,
        "",
      );

    if (!accessToken) {
      return Response.json(
        { error: "Authentication required." },
        {
          status: 401,
          headers: corsHeaders,
        },
      );
    }

    const body: InvoiceRequest =
      await req.json();

    const invoiceId =
      body.invoice_id?.trim();

    const action =
      body.action === "send"
        ? "send"
        : "pdf";

    if (!invoiceId) {
      return Response.json(
        { error: "Invoice ID is required." },
        {
          status: 400,
          headers: corsHeaders,
        },
      );
    }

    const supabaseUrl =
      Deno.env.get("SUPABASE_URL");

    const serviceRoleKey =
      Deno.env.get(
        "SUPABASE_SERVICE_ROLE_KEY",
      );

    const resendApiKey =
      Deno.env.get("RESEND_API_KEY");

    if (
      !supabaseUrl ||
      !serviceRoleKey
    ) {
      throw new Error(
        "Supabase server configuration is missing.",
      );
    }

    const supabase =
      createClient(
        supabaseUrl,
        serviceRoleKey,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
          },
        },
      );

    const publicApiKey =
      req.headers.get("apikey") ||
      Deno.env.get("SUPABASE_ANON_KEY") ||
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY");

    if (!publicApiKey) {
      throw new Error(
        "Supabase public API key is missing.",
      );
    }

    const authSupabase =
      createClient(
        supabaseUrl,
        publicApiKey,
        {
          global: {
            headers: {
              Authorization:
                "Bearer " +
                accessToken,
            },
          },
          auth: {
            autoRefreshToken: false,
            persistSession: false,
            detectSessionInUrl: false,
          },
        },
      );

    const {
      data: userData,
      error: userError,
    } =
      await authSupabase.auth.getUser(
        accessToken,
      );

    if (
      userError ||
      !userData.user
    ) {
      return Response.json(
        { error: "Your session is no longer valid." },
        {
          status: 401,
          headers: corsHeaders,
        },
      );
    }

    const {
      data: isAdmin,
      error: adminError,
    } =
      await authSupabase.rpc(
        "is_swayphics_admin",
      );

    if (
      adminError ||
      isAdmin !== true
    ) {
      return Response.json(
        {
          error:
            "You are not an active Swayphics admin.",
        },
        {
          status: 403,
          headers: corsHeaders,
        },
      );
    }

    const {
      data: invoice,
      error: invoiceError,
    } =
      await supabase
        .from("invoices")
        .select("*")
        .eq(
          "id",
          invoiceId,
        )
        .maybeSingle();

    if (invoiceError) {
      throw new Error(
        "Invoice lookup failed: " +
        invoiceError.message,
      );
    }

    if (!invoice) {
      throw new Error(
        "Invoice could not be found for ID " +
        invoiceId +
        ".",
      );
    }

    const {
      data: client,
      error: clientError,
    } =
      await supabase
        .from("clients")
        .select(
          "id,business_name,contact_name,email,phone",
        )
        .eq(
          "id",
          invoice.client_id,
        )
        .maybeSingle();

    if (clientError) {
      throw new Error(
        "Client lookup failed: " +
        clientError.message,
      );
    }

    if (!client) {
      throw new Error(
        "Client could not be found for this invoice.",
      );
    }

    invoice.client = client;

    if (
      action === "send" &&
      !String(client.email || "").trim()
    ) {
      throw new Error(
        "Client does not have an email address. Add a client email before sending the invoice.",
      );
    }

    const {
      data: items,
      error: itemsError,
    } =
      await supabase
        .from("invoice_items")
        .select(
          "description,quantity,unit_price,line_total",
        )
        .eq(
          "invoice_id",
          invoiceId,
        )
        .order(
          "created_at",
          {
            ascending: true,
          },
        );

    if (
      itemsError
    ) {
      throw new Error(
        "Invoice items could not be loaded.",
      );
    }

    const {
      data: settings,
      error: settingsError,
    } =
      await supabase
        .from("invoice_settings")
        .select("*")
        .eq("id", 1)
        .single();

    if (
      settingsError ||
      !settings
    ) {
      throw new Error(
        "Invoice settings could not be loaded.",
      );
    }

    const lineItems =
      (items || []).map(
        (item: any) => ({
          description:
            item.description,
          quantity:
            Number(item.quantity || 0),
          unit_price:
            Number(item.unit_price || 0),
          line_total:
            Number(item.line_total || 0),
        }),
      );

    if (!lineItems.length) {
      throw new Error(
        "Invoice has no line items.",
      );
    }

    if (
      action === "send" &&
      !resendApiKey
    ) {
      return Response.json(
        {
          error:
            "Email sending is not configured yet. Add RESEND_API_KEY to your Supabase Edge Function secrets.",
        },
        {
          status: 503,
          headers: corsHeaders,
        },
      );
    }

    const pdfBytes =
      await buildPdf(
        invoice,
        lineItems,
        settings,
      );

    const pdfBase64 =
      bytesToBase64(
        pdfBytes,
      );

    if (action === "pdf") {
      return Response.json(
        {
          success: true,
          invoice_number:
            invoice.invoice_number,
          filename:
            invoice.invoice_number +
            ".pdf",
          pdf_base64:
            pdfBase64,
        },
        {
          status: 200,
          headers: corsHeaders,
        },
      );
    }

    await supabase
      .from("invoices")
      .update({
        email_status: "sending",
        email_error: null,
      })
      .eq("id", invoiceId);

    const fromEmail =
      Deno.env.get(
        "RESEND_FROM_EMAIL",
      ) ||
      "Swayphics <info@swayphics.co.za>";

    const emailResponse =
      await fetch(
        "https://api.resend.com/emails",
        {
          method: "POST",
          headers: {
            Authorization:
              "Bearer " +
              resendApiKey,
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            from: fromEmail,
            to: [
              invoice.client?.email,
            ],
            subject:
              "Invoice " +
              invoice.invoice_number +
              " from Swayphics",
            html:
              emailHtml(
                invoice,
                lineItems,
                settings,
              ),
            attachments: [
              {
                filename:
                  invoice.invoice_number +
                  ".pdf",
                content:
                  pdfBase64,
              },
            ],
          }),
        },
      );

    const emailResponseText =
      await emailResponse.text();

    let emailResult: any = {};

    try {
      emailResult =
        emailResponseText
          ? JSON.parse(
              emailResponseText,
            )
          : {};
    } catch {
      emailResult = {
        raw: emailResponseText,
      };
    }

    if (!emailResponse.ok) {
      const errorMessage =
        emailResult?.message ||
        emailResult?.error?.message ||
        emailResponseText ||
        "Email provider rejected the request.";

      await supabase
        .from("invoices")
        .update({
          email_status: "failed",
          email_error:
            String(
              errorMessage,
            ).slice(0, 1000),
        })
        .eq("id", invoiceId);

      throw new Error(
        String(
          errorMessage,
        ),
      );
    }

    const emailId =
      emailResult?.id ||
      null;

    await supabase
      .from("invoices")
      .update({
        status:
          invoice.status === "draft"
            ? "sent"
            : invoice.status,
        email_status: "sent",
        sent_at:
          new Date().toISOString(),
        email_id:
          emailId,
        email_error: null,
      })
      .eq("id", invoiceId);

    return Response.json(
      {
        success: true,
        invoice_number:
          invoice.invoice_number,
        email_id:
          emailId,
      },
      {
        status: 200,
        headers: corsHeaders,
      },
    );
  } catch (error) {
    console.error(
      "Invoice function error:",
      error,
    );

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to process invoice.",
      },
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }
});
