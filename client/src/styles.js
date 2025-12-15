export const PRESETS = [
  {
    id: 'digital-futurism',
    name: 'Digital Futurism',
    target: "Tomorrow's Problem",
    suffix: ", minimalist hand-drawn black ink sketch, bright ORANGE SCARF (#FF6B35), PURE BLACK VOID (#000000), high contrast, editorial illustration.",
    timing: 13,
    accent: '#FF6B35',
    voiceDefault: 'Fenrir'
  },
  {
    id: 'productivity-sketch',
    name: 'Productivity Sketch',
    target: 'The Smart Friend',
    suffix: ", rough pencil sketch on CRUMPLED GRAPH PAPER (#FFFFFF), Graphite Black ink (#333333), Highlighter YELLOW (#FAFF00) accents, messy lines.",
    timing: 8,
    accent: '#FAFF00',
    voiceDefault: 'Puck'
  },
  {
    id: 'bible-stories',
    name: 'Bible Stories',
    target: 'Bible Stories',
    suffix: ", biblical era oil painting, golden light, ancient robes, desert landscape, cinematic 8k, dramatic lighting.",
    timing: 13,
    accent: '#D4AF37',
    voiceDefault: 'Default'
  }
];

export function autoDetectPresetId(script='') {
  const s = script.toLowerCase();
  if (s.includes('dopamine') || s.includes('focus')) return 'digital-futurism';
  if (s.includes('productivity') || s.includes('system')) return 'productivity-sketch';
  if (s.includes('god') || s.includes('jesus')) return 'bible-stories';
  return 'digital-futurism';
}
