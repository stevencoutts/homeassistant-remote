// HA area icons are mdi names; map the common room ones to the app's SVG icon keys.
// Unmapped icons fall back to a generic room icon. We do not bundle the full MDI set.
const MAP: Record<string, string> = {
  'mdi:sofa': 'sofa',
  'mdi:sofa-outline': 'sofa',
  'mdi:television': 'sofa',
  'mdi:silverware-fork-knife': 'kitchen',
  'mdi:fridge': 'kitchen',
  'mdi:countertop': 'kitchen',
  'mdi:bed': 'bed',
  'mdi:bed-outline': 'bed',
  'mdi:bed-king': 'bed',
  'mdi:desk': 'office',
  'mdi:briefcase': 'office',
  'mdi:monitor': 'office',
  'mdi:shower': 'bath',
  'mdi:bathtub': 'bath',
  'mdi:toilet': 'bath'
};

export function mapAreaIcon(mdi: string | null): string {
  if (!mdi) return 'sofa';
  return MAP[mdi] ?? 'sofa';
}
