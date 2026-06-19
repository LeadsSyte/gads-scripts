import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
} from 'docx'
import { saveAs } from 'file-saver'

export async function exportDocx(results, inputs) {
  const biz = results.businessOverview
  const comp = results.competitorIntel
  const brief = results.creativeBrief
  const companyName = biz?.company_name || 'Creative Brief'

  const children = []

  // Title
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: 'syte ', bold: true, size: 36, color: '1A2B4A' }),
        new TextRun({ text: 'Creative Brief', size: 36, color: '3B82F6' }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({ text: `${companyName} — ${inputs?.url || ''}`, size: 20, color: '666666' }),
      ],
      spacing: { after: 400 },
    })
  )

  // Business Overview
  children.push(heading('Business Overview'))
  if (biz) {
    const fields = [
      ['Company', biz.company_name],
      ['Industry', biz.industry],
      ['Geographic Focus', biz.geographic_focus],
      ['Target Audience', biz.target_audience],
      ['Brand Tone', biz.tone],
      ['Description', biz.description],
    ]
    fields.forEach(([label, value]) => {
      if (value) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: `${label}: `, bold: true, size: 20, color: '1A2B4A' }),
              new TextRun({ text: value, size: 20 }),
            ],
            spacing: { after: 100 },
          })
        )
      }
    })

    if (biz.value_props?.length) {
      children.push(subHeading('Value Propositions'))
      biz.value_props.forEach((vp) => {
        children.push(bullet(vp))
      })
    }

    if (biz.pain_points_solved?.length) {
      children.push(subHeading('Pain Points Addressed'))
      biz.pain_points_solved.forEach((pp) => {
        children.push(bullet(pp))
      })
    }
  }

  // Competitor Intel
  children.push(heading('Competitor Intelligence'))
  if (comp?.competitors) {
    comp.competitors.forEach((c) => {
      children.push(subHeading(c.name + (c.url ? ` (${c.url})` : '')))
      if (c.positioning) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: c.positioning, italics: true, size: 20 })],
            spacing: { after: 100 },
          })
        )
      }
      if (c.strengths?.length) {
        children.push(new Paragraph({ children: [new TextRun({ text: 'Strengths:', bold: true, size: 20, color: '16a34a' })], spacing: { before: 100 } }))
        c.strengths.forEach((s) => children.push(bullet(`+ ${s}`)))
      }
      if (c.weaknesses?.length) {
        children.push(new Paragraph({ children: [new TextRun({ text: 'Weaknesses:', bold: true, size: 20, color: 'dc2626' })], spacing: { before: 100 } }))
        c.weaknesses.forEach((w) => children.push(bullet(`- ${w}`)))
      }
    })

    if (comp.market_gaps?.length) {
      children.push(subHeading('Market Gaps'))
      comp.market_gaps.forEach((gap) => children.push(bullet(gap)))
    }

    if (comp.differentiation_opportunities?.length) {
      children.push(subHeading('Differentiation Opportunities'))
      comp.differentiation_opportunities.forEach((opp) => children.push(bullet(opp)))
    }
  }

  // Creative Brief
  children.push(heading('Creative Brief'))
  if (brief?.concepts) {
    brief.concepts.forEach((concept) => {
      children.push(
        subHeading(`Concept ${concept.concept_number}: ${concept.concept_name}`),
        new Paragraph({
          children: [
            new TextRun({ text: `Goal: `, bold: true, size: 20 }),
            new TextRun({ text: concept.business_goal || '', size: 20 }),
          ],
          spacing: { after: 50 },
        }),
        new Paragraph({
          children: [
            new TextRun({ text: `Audience: `, bold: true, size: 20 }),
            new TextRun({ text: concept.target_audience || '', size: 20 }),
          ],
          spacing: { after: 50 },
        }),
        new Paragraph({
          children: [
            new TextRun({ text: `Key Message: `, bold: true, size: 20 }),
            new TextRun({ text: concept.key_message || '', size: 20 }),
          ],
          spacing: { after: 200 },
        })
      )

      // Deliverables table
      if (concept.deliverables?.length) {
        const rows = [
          new TableRow({
            children: ['FORMAT', 'KEY FOCUS', 'EXAMPLE / DIRECTION'].map(
              (text) =>
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 18, color: 'FFFFFF' })], alignment: AlignmentType.CENTER })],
                  shading: { fill: '1A2B4A' },
                  width: { size: 33, type: WidthType.PERCENTAGE },
                })
            ),
          }),
        ]

        concept.deliverables.forEach((del) => {
          const format = (del.format || '').toUpperCase()
          const keyFocus = del.messaging_pointers || ''
          let direction = ''
          if (del.format === 'carousel' && del.cards) {
            direction = del.cards.map((c) => `Card ${c.card_number}: "${c.card_text}"`).join('\n')
          } else {
            direction = `Visual: ${del.visual_direction_feed || ''}\nAd Copy: ${del.ad_copy?.primary_text || ''}`
          }

          rows.push(
            new TableRow({
              children: [format, keyFocus, direction].map(
                (text) =>
                  new TableCell({
                    children: [new Paragraph({ children: [new TextRun({ text, size: 18 })], spacing: { after: 50 } })],
                    width: { size: 33, type: WidthType.PERCENTAGE },
                  })
              ),
            })
          )
        })

        children.push(
          new Table({
            rows,
            width: { size: 100, type: WidthType.PERCENTAGE },
          }),
          new Paragraph({ spacing: { after: 200 } })
        )
      }
    })

    if (brief.ctas?.length) {
      children.push(
        subHeading('Recommended CTAs'),
        new Paragraph({
          children: [new TextRun({ text: brief.ctas.join(' | '), bold: true, size: 22, color: '3B82F6' })],
          spacing: { after: 200 },
        })
      )
    }

    if (brief.general_notes) {
      children.push(
        subHeading('General Notes'),
        new Paragraph({
          children: [new TextRun({ text: brief.general_notes, size: 20 })],
          spacing: { after: 200 },
        })
      )
    }
  }

  // Footer
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: 'Generated by Syte Creative Brief Generator — syte.co.za', size: 16, color: '999999', italics: true }),
      ],
      spacing: { before: 400 },
    })
  )

  const doc = new Document({
    sections: [{ children }],
    styles: {
      default: {
        document: {
          run: { font: 'Calibri' },
        },
      },
    },
  })

  const blob = await Packer.toBlob(doc)
  saveAs(blob, `${companyName.replace(/\s+/g, '-')}-Creative-Brief.docx`)
}

function heading(text) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 28, color: '1A2B4A' })],
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: '3B82F6' } },
  })
}

function subHeading(text) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 22, color: '1A2B4A' })],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 100 },
  })
}

function bullet(text) {
  return new Paragraph({
    children: [new TextRun({ text, size: 20 })],
    bullet: { level: 0 },
    spacing: { after: 50 },
  })
}
