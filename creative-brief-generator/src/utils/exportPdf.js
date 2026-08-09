import jsPDF from 'jspdf'
import 'jspdf-autotable'

const NAVY = [26, 43, 74]
const BLUE = [59, 130, 246]
const LIGHT_GRAY = [245, 245, 245]

export async function exportPdf(results, inputs) {
  const doc = new jsPDF('p', 'mm', 'a4')
  const pageWidth = doc.internal.pageSize.getWidth()
  let y = 20

  // Header
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, pageWidth, 35, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(20)
  doc.setFont('helvetica', 'bold')
  doc.text('syte', 15, 18)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text('Creative Brief Generator', 15, 27)

  const companyName = results.businessOverview?.company_name || 'Creative Brief'
  doc.setFontSize(12)
  doc.text(companyName, pageWidth - 15, 18, { align: 'right' })
  doc.setFontSize(8)
  doc.text(inputs?.url || '', pageWidth - 15, 25, { align: 'right' })

  y = 45

  // Business Overview Section
  y = sectionHeader(doc, 'Business Overview', y, pageWidth)
  const biz = results.businessOverview
  if (biz) {
    const bizData = [
      ['Company', biz.company_name || ''],
      ['Industry', biz.industry || ''],
      ['Geographic Focus', biz.geographic_focus || ''],
      ['Target Audience', biz.target_audience || ''],
      ['Brand Tone', biz.tone || ''],
      ['Description', biz.description || ''],
    ]
    doc.autoTable({
      startY: y,
      head: [],
      body: bizData,
      theme: 'plain',
      styles: { fontSize: 9, cellPadding: 3 },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 40, textColor: NAVY },
        1: { cellWidth: 'auto' },
      },
      margin: { left: 15, right: 15 },
    })
    y = doc.lastAutoTable.finalY + 5

    if (biz.value_props && biz.value_props.length > 0) {
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...NAVY)
      doc.text('Value Propositions', 15, y)
      y += 5
      biz.value_props.forEach((vp) => {
        if (y > 270) { doc.addPage(); y = 20 }
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9)
        doc.setTextColor(80, 80, 80)
        doc.text(`• ${vp}`, 18, y)
        y += 5
      })
      y += 5
    }
  }

  // Competitor Intel Section
  if (y > 240) { doc.addPage(); y = 20 }
  y = sectionHeader(doc, 'Competitor Intelligence', y, pageWidth)
  const comp = results.competitorIntel
  if (comp && comp.competitors) {
    comp.competitors.forEach((c) => {
      if (y > 230) { doc.addPage(); y = 20 }
      doc.autoTable({
        startY: y,
        head: [[c.name, 'Details']],
        body: [
          ['Positioning', c.positioning || ''],
          ['Strengths', (c.strengths || []).join('; ')],
          ['Weaknesses', (c.weaknesses || []).join('; ')],
        ],
        theme: 'striped',
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: NAVY, fontSize: 9 },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 30 } },
        margin: { left: 15, right: 15 },
      })
      y = doc.lastAutoTable.finalY + 5
    })

    if (comp.market_gaps && comp.market_gaps.length > 0) {
      if (y > 250) { doc.addPage(); y = 20 }
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...NAVY)
      doc.text('Market Gaps', 15, y)
      y += 5
      comp.market_gaps.forEach((gap) => {
        if (y > 270) { doc.addPage(); y = 20 }
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9)
        doc.setTextColor(80, 80, 80)
        doc.text(`→ ${gap}`, 18, y)
        y += 5
      })
      y += 5
    }
  }

  // Creative Brief Section
  doc.addPage()
  y = 20
  y = sectionHeader(doc, 'Creative Brief', y, pageWidth)
  const brief = results.creativeBrief
  if (brief && brief.concepts) {
    brief.concepts.forEach((concept) => {
      if (y > 230) { doc.addPage(); y = 20 }

      // Concept header
      doc.setFillColor(...BLUE)
      doc.rect(15, y - 4, pageWidth - 30, 10, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.text(`Concept ${concept.concept_number}: ${concept.concept_name}`, 18, y + 2)
      y += 12

      doc.setTextColor(80, 80, 80)
      doc.setFontSize(8)
      doc.setFont('helvetica', 'normal')
      doc.text(`Goal: ${concept.business_goal || ''}`, 18, y)
      y += 4
      doc.text(`Audience: ${concept.target_audience || ''}`, 18, y)
      y += 4
      doc.text(`Key Message: ${concept.key_message || ''}`, 18, y)
      y += 8

      // Deliverables table
      const tableBody = []
      ;(concept.deliverables || []).forEach((del) => {
        const format = (del.format || '').toUpperCase()
        let keyFocus = del.messaging_pointers || ''
        let direction = ''

        if (del.format === 'carousel' && del.cards) {
          direction = del.cards.map((c) => `Card ${c.card_number}: "${c.card_text}"`).join('\n')
        } else {
          direction = `Visual: ${del.visual_direction_feed || ''}\nMessaging: ${del.ad_copy?.primary_text || ''}`
        }

        tableBody.push([format, keyFocus, direction])
      })

      if (tableBody.length > 0) {
        doc.autoTable({
          startY: y,
          head: [['FORMAT', 'KEY FOCUS', 'EXAMPLE / DIRECTION']],
          body: tableBody,
          theme: 'grid',
          styles: { fontSize: 7, cellPadding: 3, overflow: 'linebreak' },
          headStyles: { fillColor: NAVY, fontSize: 8 },
          columnStyles: {
            0: { cellWidth: 25, fontStyle: 'bold' },
            1: { cellWidth: 40 },
            2: { cellWidth: 'auto' },
          },
          margin: { left: 15, right: 15 },
        })
        y = doc.lastAutoTable.finalY + 8
      }
    })

    // CTAs
    if (brief.ctas && brief.ctas.length > 0) {
      if (y > 260) { doc.addPage(); y = 20 }
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...NAVY)
      doc.text('Recommended CTAs: ' + brief.ctas.join(' | '), 15, y)
      y += 8
    }
  }

  // Footer on each page
  const totalPages = doc.internal.getNumberOfPages()
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    doc.setFontSize(7)
    doc.setTextColor(150, 150, 150)
    doc.text('Generated by Syte Creative Brief Generator — syte.co.za', 15, 290)
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - 15, 290, { align: 'right' })
  }

  doc.save(`${companyName.replace(/\s+/g, '-')}-Creative-Brief.pdf`)
}

function sectionHeader(doc, title, y, pageWidth) {
  doc.setFillColor(...LIGHT_GRAY)
  doc.rect(15, y - 5, pageWidth - 30, 12, 'F')
  doc.setTextColor(...NAVY)
  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.text(title, 18, y + 2)
  return y + 14
}
