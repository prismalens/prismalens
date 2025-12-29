'use client';

/**
 * ExtensionSlot Component
 *
 * Renders components registered by extensions for a specific UI slot.
 * In community mode, renders nothing. In enterprise mode, renders
 * the components defined in the extension manifest.
 */

import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { extensionLoader } from '@/lib/extension-sdk';

interface ExtensionSlotProps {
  /**
   * The view name (e.g., 'layout', 'settings', 'dashboard')
   */
  view: string;

  /**
   * The slot name within the view (e.g., 'navbar-right', 'tabs')
   */
  slot: string;

  /**
   * Wrapper element for slot components
   */
  wrapper?: ComponentType<{ children: ReactNode }>;

  /**
   * CSS class name for the container
   */
  className?: string;

  /**
   * Fallback content when no extensions are loaded
   */
  fallback?: ReactNode;
}

/**
 * Renders extension components for a specific UI slot.
 *
 * @example
 * ```tsx
 * <ExtensionSlot
 *   view="layout"
 *   slot="navbar-right"
 *   className="flex items-center gap-2"
 * />
 * ```
 */
export function ExtensionSlot({
  view,
  slot,
  wrapper: Wrapper,
  className,
  fallback,
}: ExtensionSlotProps) {
  const [components, setComponents] = useState<ComponentType[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function loadSlotComponents() {
      // Ensure extensions are loaded
      if (!extensionLoader.isLoaded) {
        await extensionLoader.loadExtensions();
      }

      const slotComponents = extensionLoader.getSlotComponents(view, slot);
      setComponents(slotComponents);
      setLoaded(true);
    }

    loadSlotComponents();
  }, [view, slot]);

  // Not loaded yet
  if (!loaded) {
    return null;
  }

  // No components for this slot
  if (components.length === 0) {
    return fallback ? <>{fallback}</> : null;
  }

  // Render slot components
  const content = (
    <>
      {components.map((Component, index) => (
        <Component key={`${view}-${slot}-${index}`} />
      ))}
    </>
  );

  // Wrap if wrapper provided
  if (Wrapper) {
    return (
      <div className={className}>
        <Wrapper>{content}</Wrapper>
      </div>
    );
  }

  return <div className={className}>{content}</div>;
}

/**
 * Hook to get components for a slot.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { components, isLoaded } = useSlotComponents('layout', 'navbar-right');
 *
 *   if (!isLoaded) return null;
 *
 *   return components.map((C, i) => <C key={i} />);
 * }
 * ```
 */
export function useSlotComponents(view: string, slot: string) {
  const [components, setComponents] = useState<ComponentType[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    async function load() {
      if (!extensionLoader.isLoaded) {
        await extensionLoader.loadExtensions();
      }

      setComponents(extensionLoader.getSlotComponents(view, slot));
      setIsLoaded(true);
    }

    load();
  }, [view, slot]);

  return { components, isLoaded };
}

/**
 * Hook to check if the current edition is enterprise.
 */
export function useIsEnterprise() {
  const [isEnterprise, setIsEnterprise] = useState(false);

  useEffect(() => {
    async function check() {
      if (!extensionLoader.isLoaded) {
        await extensionLoader.loadExtensions();
      }
      setIsEnterprise(extensionLoader.isEnterprise);
    }

    check();
  }, []);

  return isEnterprise;
}

/**
 * Hook to get the current edition.
 */
export function useEdition() {
  const [edition, setEdition] = useState(extensionLoader.edition);

  useEffect(() => {
    async function load() {
      if (!extensionLoader.isLoaded) {
        await extensionLoader.loadExtensions();
      }
      setEdition(extensionLoader.edition);
    }

    load();
  }, []);

  return edition;
}
