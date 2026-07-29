module.exports = {
  launch_options: {
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
  pdf_options: {
    format: "A4",
    margin: { top: "20mm", bottom: "20mm", left: "18mm", right: "18mm" },
    printBackground: true,
  },
  stylesheet: ["scripts/huong-dan-pdf.css"],
};
