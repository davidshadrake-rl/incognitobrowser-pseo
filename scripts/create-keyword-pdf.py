import json
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    HRFlowable, KeepTogether
)
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER

with open('data/taxonomy.json', 'r') as f:
    data = json.load(f)

niches = sorted(data['niches'], key=lambda n: (n['tier'], n['name']))

primary_count = sum(len(n['keywords']) for n in niches)
subtopic_count = sum(len(n.get('context', {}).get('subtopics', [])) for n in niches)
total_kw = primary_count + subtopic_count

tier_names = {
    1: 'Core Privacy',
    2: 'Intermediate',
    3: 'Specialized',
    4: 'Legal & Regulatory',
    5: 'Advanced'
}

output_path = 'Incognito Browser - Keyword Research.pdf'
doc = SimpleDocTemplate(output_path, pagesize=letter,
                        leftMargin=0.75*inch, rightMargin=0.75*inch,
                        topMargin=0.75*inch, bottomMargin=0.75*inch)

dark = HexColor('#1a1a1a')
mid = HexColor('#555555')
light = HexColor('#999999')
accent = HexColor('#2563eb')
line_color = HexColor('#e0e0e0')

title_style = ParagraphStyle('Title', fontName='Helvetica-Bold', fontSize=36, textColor=dark, alignment=TA_CENTER, spaceAfter=8)
subtitle_style = ParagraphStyle('Subtitle', fontName='Helvetica', fontSize=16, textColor=mid, alignment=TA_CENTER, spaceAfter=6)
stats_style = ParagraphStyle('Stats', fontName='Helvetica', fontSize=12, textColor=light, alignment=TA_CENTER, spaceAfter=6)
url_style = ParagraphStyle('URL', fontName='Helvetica', fontSize=11, textColor=accent, alignment=TA_CENTER)

heading1 = ParagraphStyle('H1', fontName='Helvetica-Bold', fontSize=18, textColor=dark, spaceBefore=16, spaceAfter=8)
heading2 = ParagraphStyle('H2', fontName='Helvetica-Bold', fontSize=14, textColor=dark, spaceBefore=4, spaceAfter=4)
body = ParagraphStyle('Body', fontName='Helvetica', fontSize=10, textColor=HexColor('#333333'), leading=14, spaceAfter=4)
label_style = ParagraphStyle('Label', fontName='Helvetica-Bold', fontSize=9, textColor=mid, spaceAfter=1)
value_style = ParagraphStyle('Value', fontName='Helvetica', fontSize=9.5, textColor=HexColor('#333333'), leading=13, spaceAfter=6)
small = ParagraphStyle('Small', fontName='Helvetica', fontSize=7.5, textColor=HexColor('#444444'), leading=10)
small_bold = ParagraphStyle('SmallBold', fontName='Helvetica-Bold', fontSize=7.5, textColor=HexColor('#444444'), leading=10)

story = []

# --- Title Page ---
story.append(Spacer(1, 2.5*inch))
story.append(Paragraph('Incognito Browser', title_style))
story.append(Spacer(1, 12))
story.append(Paragraph('Keyword Research &amp; Content Strategy', subtitle_style))
story.append(Spacer(1, 20))
story.append(HRFlowable(width='30%', thickness=1, color=line_color, spaceAfter=20))
story.append(Paragraph(f'{len(niches)} Niches  |  {total_kw} Keywords  |  5 Tiers', stats_style))
story.append(Spacer(1, 1.5*inch))
story.append(Paragraph('incognitobrowser.io', url_style))
story.append(PageBreak())

# --- Executive Summary ---
story.append(Paragraph('Executive Summary', heading1))
story.append(HRFlowable(width='100%', thickness=1, color=line_color, spaceAfter=12))
story.append(Paragraph(
    f'This document outlines the keyword research underpinning the Incognito Browser '
    f'programmatic SEO system. The taxonomy covers <b>{len(niches)} privacy niches</b> across '
    f'<b>5 tiers</b>, targeting <b>{total_kw} keywords</b> ({primary_count} primary + '
    f'{subtopic_count} long-tail subtopics). Each niche is mapped to a specific audience, '
    f'their pain points, monetization strategy, and content approach.',
    body
))
story.append(Spacer(1, 16))

story.append(Paragraph('Tier Breakdown', heading2))
for tier in range(1, 6):
    tier_niches = [n for n in niches if n['tier'] == tier]
    tier_kw = sum(len(n['keywords']) + len(n.get('context', {}).get('subtopics', [])) for n in tier_niches)
    story.append(Paragraph(
        f'<b>Tier {tier} — {tier_names[tier]}</b>: {len(tier_niches)} niches, {tier_kw} keywords',
        body
    ))

story.append(Spacer(1, 16))
story.append(Paragraph('Content Types Generated Per Niche', heading2))
content_types = [
    ('Checklists', '2 per niche', '88 total'),
    ('Guides', '3 per niche', '132 total'),
    ('Comparisons', '1 per niche', '44 total'),
    ('Templates', '2 per niche', '88 total'),
    ('Calculators', '1 per niche', '44 total'),
    ('Glossary', 'flat', '106 terms'),
]
ct_data = [['Type', 'Per Niche', 'Total']] + content_types
ct_table = Table(ct_data, colWidths=[2*inch, 1.5*inch, 1.5*inch])
ct_table.setStyle(TableStyle([
    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
    ('FONTSIZE', (0, 0), (-1, -1), 9),
    ('TEXTCOLOR', (0, 0), (-1, 0), dark),
    ('LINEBELOW', (0, 0), (-1, 0), 1, line_color),
    ('LINEBELOW', (0, -1), (-1, -1), 1, line_color),
    ('TOPPADDING', (0, 0), (-1, -1), 4),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
]))
story.append(ct_table)
story.append(PageBreak())

# --- Niche-by-Niche Breakdown ---
for tier in range(1, 6):
    tier_niches = [n for n in niches if n['tier'] == tier]
    story.append(Paragraph(f'Tier {tier} — {tier_names[tier]} ({len(tier_niches)} niches)', heading1))
    story.append(HRFlowable(width='100%', thickness=2, color=dark, spaceAfter=12))

    for i, niche in enumerate(tier_niches):
        ctx = niche.get('context', {})
        block = []
        block.append(Paragraph(niche['name'], heading2))
        block.append(Paragraph('Primary Keywords', label_style))
        block.append(Paragraph(', '.join(niche['keywords']), value_style))
        block.append(Paragraph('Long-Tail Subtopics', label_style))
        block.append(Paragraph(', '.join(ctx.get('subtopics', [])), value_style))
        block.append(Paragraph('Audience', label_style))
        block.append(Paragraph(ctx.get('audience', ''), value_style))
        block.append(Paragraph('Pain Points', label_style))
        block.append(Paragraph(ctx.get('pain_points', ''), value_style))
        block.append(Paragraph('Content Strategy', label_style))
        block.append(Paragraph(ctx.get('content_that_works', ''), value_style))
        block.append(Paragraph('Monetization', label_style))
        block.append(Paragraph(ctx.get('monetization', ''), value_style))

        if i < len(tier_niches) - 1:
            block.append(HRFlowable(width='100%', thickness=0.5, color=line_color, spaceBefore=6, spaceAfter=8))

        story.append(KeepTogether(block))

    story.append(PageBreak())

# --- Keyword Index ---
story.append(Paragraph('Keyword Index', heading1))
story.append(HRFlowable(width='100%', thickness=1, color=line_color, spaceAfter=8))
story.append(Paragraph(f'All {total_kw} keywords sorted alphabetically.', body))
story.append(Spacer(1, 8))

rows = []
for niche in niches:
    for kw in niche['keywords']:
        rows.append((kw, 'Primary', niche['name']))
    for st in niche.get('context', {}).get('subtopics', []):
        rows.append((st, 'Subtopic', niche['name']))
rows.sort(key=lambda r: r[0].lower())

mid_point = len(rows) // 2
col1 = rows[:mid_point]
col2 = rows[mid_point:]

index_data = [['Keyword', 'Type', 'Niche', '', 'Keyword', 'Type', 'Niche']]
for i in range(max(len(col1), len(col2))):
    r1 = col1[i] if i < len(col1) else ('', '', '')
    r2 = col2[i] if i < len(col2) else ('', '', '')
    index_data.append([
        Paragraph(r1[0], small), Paragraph(r1[1], small), Paragraph(r1[2], small),
        '',
        Paragraph(r2[0], small), Paragraph(r2[1], small), Paragraph(r2[2], small),
    ])

col_w = [1.8*inch, 0.6*inch, 1.3*inch, 0.1*inch, 1.8*inch, 0.6*inch, 1.3*inch]
idx_table = Table(index_data, colWidths=col_w, repeatRows=1)
idx_table.setStyle(TableStyle([
    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
    ('FONTSIZE', (0, 0), (-1, 0), 8),
    ('TEXTCOLOR', (0, 0), (-1, 0), dark),
    ('LINEBELOW', (0, 0), (-1, 0), 1, line_color),
    ('TOPPADDING', (0, 0), (-1, -1), 2),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
]))
story.append(idx_table)

doc.build(story)
print(f'Created {output_path}')
