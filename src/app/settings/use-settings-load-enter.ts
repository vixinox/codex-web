import * as React from 'react'

import { useGsapEnter } from '@/lib/platform/browser/use-gsap-enter'

export function useSettingsLoadEnter<T extends HTMLElement>(dependencies: React.DependencyList) {
  return useGsapEnter<T>(dependencies, { duration: 0.3, y: 4 })
}
