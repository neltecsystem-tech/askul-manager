import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

// 指定要素をA4縦のPDFにラスタライズ出力する（縦に長い場合は複数ページに分割）
export async function exportElementToPdf(el: HTMLElement, filename: string): Promise<void> {
  const canvas = await html2canvas(el, {
    scale: 2,
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
    windowWidth: el.scrollWidth,
  });

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pdfW = pdf.internal.pageSize.getWidth();
  const pdfH = pdf.internal.pageSize.getHeight();
  const margin = 5;
  const imgW = pdfW - margin * 2;
  const imgH = (canvas.height * imgW) / canvas.width;
  const imgData = canvas.toDataURL('image/jpeg', 0.92);

  let heightLeft = imgH;
  let position = margin;
  pdf.addImage(imgData, 'JPEG', margin, position, imgW, imgH);
  heightLeft -= pdfH - margin;

  while (heightLeft > 0) {
    position -= pdfH - margin;
    pdf.addPage();
    pdf.addImage(imgData, 'JPEG', margin, position, imgW, imgH);
    heightLeft -= pdfH - margin;
  }

  pdf.save(filename);
}
