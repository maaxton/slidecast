<script>
  import { createEventDispatcher } from 'svelte';

  export let data = null;
  export let expanded = false;
  export let label = null;
  // Internal props for recursion
  export let _depth = 0;
  export let _key = null;
  export let _isRoot = true;

  let isExpanded = expanded;

  const dispatch = createEventDispatcher();

  function toggle() {
    isExpanded = !isExpanded;
  }

  function getType(val) {
    if (val === null) return 'null';
    if (Array.isArray(val)) return 'array';
    return typeof val;
  }

  function copyJson() {
    try {
      navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    } catch (e) {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = JSON.stringify(data, null, 2);
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  }

  $: type = getType(data);
  $: isCollapsible = type === 'object' || type === 'array';
  $: keys = isCollapsible ? (type === 'array' ? data.map((_, i) => i) : Object.keys(data || {})) : [];
  $: openBracket = type === 'array' ? '[' : '{';
  $: closeBracket = type === 'array' ? ']' : '}';
  $: previewLabel = isCollapsible
    ? (isExpanded ? '' : `${openBracket}${keys.length > 0 ? '...' : ''}${closeBracket}`)
    : '';
</script>

{#if _isRoot && _depth === 0}
  <div class="json-tree-root">
    {#if label || _isRoot}
      <div class="json-root-header">
        {#if label}
          <span class="json-root-label">{label}</span>
        {/if}
        <button class="copy-btn" on:click={copyJson} title="Copy JSON">Copy</button>
      </div>
    {/if}
    <div class="json-tree-inner">
      <svelte:self data={data} _depth={0} _isRoot={false} expanded={isExpanded} />
    </div>
  </div>
{:else if type === 'null'}
  <span class="json-row">
    {#if _key !== null}
      <span class="json-key">{type === 'array' ? _key : `"${_key}"`}: </span>
    {/if}
    <span class="json-null">null</span>
  </span>
{:else if type === 'boolean'}
  <span class="json-row">
    {#if _key !== null}
      <span class="json-key">{typeof _key === 'number' ? _key : `"${_key}"`}: </span>
    {/if}
    <span class="json-bool">{data}</span>
  </span>
{:else if type === 'number'}
  <span class="json-row">
    {#if _key !== null}
      <span class="json-key">{typeof _key === 'number' ? _key : `"${_key}"`}: </span>
    {/if}
    <span class="json-number">{data}</span>
  </span>
{:else if type === 'string'}
  <span class="json-row">
    {#if _key !== null}
      <span class="json-key">{typeof _key === 'number' ? _key : `"${_key}"`}: </span>
    {/if}
    <span class="json-string">"{data}"</span>
  </span>
{:else if isCollapsible}
  <div class="json-node" style="padding-left: {_depth > 0 ? 14 : 0}px">
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <span class="json-toggle" on:click={toggle}>
      {#if _key !== null}
        <span class="json-key">{typeof _key === 'number' ? _key : `"${_key}"`}: </span>
      {/if}
      <span class="json-bracket">{openBracket}</span>
      {#if !isExpanded}
        <span class="json-preview">{keys.length > 0 ? '...' : ''}</span>
        <span class="json-bracket">{closeBracket}</span>
        <span class="json-count">{keys.length} {type === 'array' ? 'items' : 'keys'}</span>
      {:else}
        <span class="json-expand-hint">▾</span>
      {/if}
    </span>

    {#if isExpanded}
      <div class="json-children">
        {#each keys as k}
          <svelte:self
            data={type === 'array' ? data[k] : data[k]}
            _depth={_depth + 1}
            _key={k}
            _isRoot={false}
            expanded={false}
          />
        {/each}
      </div>
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <span class="json-close" on:click={toggle}>
        <span class="json-bracket">{closeBracket}</span>
      </span>
    {/if}
  </div>
{/if}

<style>
  .json-tree-root {
    font-family: 'Monaco', 'Menlo', 'Consolas', 'Courier New', monospace;
    font-size: 12px;
    line-height: 1.6;
    color: #e0e0e0;
    background: #0d0d1a;
    border-radius: 6px;
    overflow: hidden;
  }

  .json-root-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: #1a1a2e;
    border-bottom: 1px solid #3d3d5c;
  }

  .json-root-label {
    font-size: 11px;
    font-weight: 600;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .copy-btn {
    padding: 3px 10px;
    font-size: 11px;
    font-family: inherit;
    background: #252542;
    color: #a0a0c0;
    border: 1px solid #3d3d5c;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .copy-btn:hover {
    background: #6366f1;
    color: white;
    border-color: #6366f1;
  }

  .json-tree-inner {
    padding: 10px 12px;
    overflow-x: auto;
    max-height: 400px;
    overflow-y: auto;
  }

  .json-row {
    display: block;
    white-space: pre-wrap;
    word-break: break-all;
    padding: 1px 0;
  }

  .json-node {
    display: block;
  }

  .json-toggle {
    display: inline;
    cursor: pointer;
    user-select: none;
  }

  .json-toggle:hover .json-bracket {
    color: #a78bfa;
  }

  .json-children {
    padding-left: 14px;
    border-left: 1px solid #3d3d5c;
    margin-left: 4px;
  }

  .json-close {
    display: block;
    cursor: pointer;
    user-select: none;
  }

  .json-close:hover .json-bracket {
    color: #a78bfa;
  }

  .json-key {
    color: #93c5fd;
  }

  .json-string {
    color: #4ade80;
  }

  .json-number {
    color: #60a5fa;
  }

  .json-bool {
    color: #fb923c;
  }

  .json-null {
    color: #6b7280;
    font-style: italic;
  }

  .json-bracket {
    color: #e0e0e0;
    font-weight: 600;
  }

  .json-preview {
    color: #6b7280;
    font-style: italic;
  }

  .json-count {
    margin-left: 6px;
    font-size: 10px;
    color: #555;
  }

  .json-expand-hint {
    color: #555;
    font-size: 10px;
    margin-left: 2px;
  }
</style>
