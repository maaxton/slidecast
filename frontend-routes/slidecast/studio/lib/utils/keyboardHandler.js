/**
 * Keyboard Handler - Keyboard shortcuts and input handling
 *
 * This module provides utility functions for keyboard handling, but the main
 * handleKeyboard function should remain in the component file to access local
 * state and callbacks. This file contains helper functions that can be reused.
 */

import { get } from 'svelte/store';
import * as store from '../stores/studioStore.js';
import * as canvas from './canvasControls.js';

/**
 * Handle refresh intercept (F5 or Ctrl+R/Cmd+R)
 * @param {KeyboardEvent} e - Keyboard event
 * @param {Function} checkUnsavedChanges - Function that returns true if there are unsaved changes
 * @param {Function} showModal - Function to show unsaved changes modal
 */
export function handleRefreshIntercept(e, checkUnsavedChanges, showModal) {
  // F5 or Cmd/Ctrl+R
  const isRefresh = e.key === 'F5' || ((e.metaKey || e.ctrlKey) && e.key === 'r');
  if (isRefresh && checkUnsavedChanges()) {
    e.preventDefault();
    showModal();
  }
}
