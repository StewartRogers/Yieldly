Apply fintech UI design principles to the component or page described in $ARGUMENTS.

Design rules to follow:
- White card surfaces with subtle gray page backgrounds (#f8f9fa or Tailwind bg-gray-50)
- Blue primary actions (shadcn/ui default blue or Tailwind blue-600)
- Border radius 8–12px on cards and inputs
- Soft shadows (shadow-sm or shadow-md)
- Minimal visible borders (border-gray-100 or border-gray-200)
- Inter font, clear hierarchy, body text 16px

Typography hierarchy:
- Page title: text-2xl font-semibold
- Section heading: text-lg font-medium text-gray-700
- Metric value: text-3xl font-bold text-gray-900
- Muted label: text-sm text-gray-500

Component patterns:
- **Cards**: white bg, rounded-xl, p-6, shadow-sm, border border-gray-100
- **Tables**: clean header (bg-gray-50), hover:bg-gray-50 rows, text-right for numbers
- **Stat tiles**: muted label above, large bold value, optional trend indicator
- **Nav**: horizontal top bar, active item underline or bg highlight

Layout:
- Mobile-first with Tailwind responsive prefixes (sm:, md:, lg:)
- Flexbox and Grid preferred over absolute positioning
- Consistent spacing: gap-4 / gap-6 between cards, p-4 / p-6 inside cards

shadcn/ui components to prefer:
- Card, CardHeader, CardContent, CardTitle for containers
- Table, TableHeader, TableBody, TableRow, TableCell for data
- Button (variant="default" for primary, "outline" for secondary)
- Badge for status labels
- Tabs for page-level navigation between views
