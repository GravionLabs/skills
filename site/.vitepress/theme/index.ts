import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import { enableDiagramZoom } from './diagram-zoom';
import './diagram-zoom.css';

export default {
  extends: DefaultTheme,
  enhanceApp() {
    if (typeof window !== 'undefined') enableDiagramZoom(document);
  },
} satisfies Theme;
