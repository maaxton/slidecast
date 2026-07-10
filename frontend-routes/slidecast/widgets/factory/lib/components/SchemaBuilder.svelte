<script>
  import { createEventDispatcher } from 'svelte';

  export let show = false;
  export let type = 'config'; // 'config' or 'style'
  export let editingSchema = {};
  export let editingSchemaTabs = [];
  export let activeTab = 'default';
  export let newFieldKey = '';
  export let newFieldType = 'string';
  export let showAddTabForm = false;
  export let newSchemaTabId = '';
  export let newSchemaTabLabel = '';
  export let newSchemaTabIcon = '📋';
  
  // Field types
  export let FIELD_TYPES = [];
  export let TAB_ICONS = [];
  export let STYLE_GROUPS = [];

  // Delete tab confirmation state
  let showDeleteConfirm = false;
  let tabToDelete = null;
  let deleteAction = 'move'; // 'move' or 'delete'
  let moveToTab = 'default';

  // Delete field confirmation state
  let showDeleteFieldConfirm = false;
  let fieldToDelete = null;

  const dispatch = createEventDispatcher();

  function handleClose() {
    dispatch('close');
  }

  function handleSave() {
    dispatch('save');
  }

  function handleTabSelect(tabId) {
    dispatch('tabSelect', { tabId });
  }

  function handleAddTab() {
    dispatch('addTab', { id: newSchemaTabId, label: newSchemaTabLabel, icon: newSchemaTabIcon });
  }

  function promptDeleteTab(tabId) {
    const tab = editingSchemaTabs.find(t => t.id === tabId);
    const fieldCount = getFieldsForTab(editingSchema, tabId).length;
    
    if (fieldCount === 0) {
      // No fields, just delete
      dispatch('removeTab', { tabId });
      return;
    }
    
    // Has fields, show confirmation
    tabToDelete = { id: tabId, label: tab?.label || tabId, fieldCount };
    deleteAction = 'move';
    moveToTab = 'default';
    showDeleteConfirm = true;
  }

  function confirmDeleteTab() {
    if (!tabToDelete) return;
    
    dispatch('removeTab', { 
      tabId: tabToDelete.id, 
      action: deleteAction, 
      moveToTab: deleteAction === 'move' ? moveToTab : null 
    });
    
    showDeleteConfirm = false;
    tabToDelete = null;
  }

  function cancelDeleteTab() {
    showDeleteConfirm = false;
    tabToDelete = null;
  }

  function handleMoveTab(index, direction) {
    dispatch('moveTab', { index, direction });
  }

  function handleAddField() {
    dispatch('addField', { key: newFieldKey, type: newFieldType });
  }

  function promptDeleteField(key) {
    const field = editingSchema[key];
    fieldToDelete = { key, label: field?.label || key, type: field?.type || 'unknown' };
    showDeleteFieldConfirm = true;
  }

  function confirmDeleteField() {
    if (!fieldToDelete) return;
    dispatch('removeField', { key: fieldToDelete.key });
    showDeleteFieldConfirm = false;
    fieldToDelete = null;
  }

  function cancelDeleteField() {
    showDeleteFieldConfirm = false;
    fieldToDelete = null;
  }

  function handleMoveField(key, tabId) {
    dispatch('moveField', { key, tabId });
  }

  function handleAddFieldOption(key) {
    dispatch('addFieldOption', { key });
  }

  function handleRemoveFieldOption(key, index) {
    dispatch('removeFieldOption', { key, index });
  }

  function handleFieldUpdate(key, field) {
    dispatch('fieldUpdate', { key, field });
  }

  // Pass schema explicitly so Svelte properly tracks the dependency
  function getFieldsForTab(schema, tabId) {
    if (!schema) return [];
    return Object.entries(schema).filter(([key, field]) => {
      if (key === '_tabs') return false;
      const fieldTab = field.tab || 'default';
      return fieldTab === tabId;
    });
  }

  // Get available tabs to move fields to (excluding the one being deleted)
  $: availableMoveTabs = [
    { id: 'default', label: 'Default', icon: '⚙️' },
    ...editingSchemaTabs.filter(t => t.id !== tabToDelete?.id)
  ];

  // Explicitly pass editingSchema so Svelte tracks it as a dependency
  $: fieldsForActiveTab = getFieldsForTab(editingSchema, activeTab);
  $: activeTabData = activeTab === 'default' ? null : editingSchemaTabs.find(t => t.id === activeTab);
</script>

{#if show}
  <div class="modal-overlay" on:click={handleClose}>
    <div class="modal modal-xl" on:click|stopPropagation>
      <div class="modal-header">
        <h2>{type === 'config' ? '⚙️ Config Schema Builder' : '🎨 Style Schema Builder'}</h2>
        <button class="close-btn" on:click={handleClose}>
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      
      <!-- Tab Bar -->
      <div class="schema-tab-bar">
        <!-- Custom Tabs -->
        {#each editingSchemaTabs as tab, idx}
          <div class="schema-tab-item" class:active={activeTab === tab.id}>
            <button 
              class="schema-tab-btn" 
              on:click={() => handleTabSelect(tab.id)}
              title="Click to select, right-click to delete"
            >
              <span class="tab-icon">{tab.icon}</span>
              <span class="tab-label">{tab.label}</span>
              <span class="tab-count">{getFieldsForTab(editingSchema, tab.id).length}</span>
            </button>
            <button 
              class="tab-action-btn tab-delete" 
              on:click={() => promptDeleteTab(tab.id)}
              title="Delete tab"
            >×</button>
          </div>
        {/each}
        
        <!-- Default Tab -->
        <button 
          class="schema-tab-btn default-tab" 
          class:active={activeTab === 'default'}
          on:click={() => handleTabSelect('default')}
        >
          <span class="tab-icon">⚙️</span>
          <span class="tab-label">Default</span>
          <span class="tab-count">{getFieldsForTab(editingSchema, 'default').length}</span>
        </button>
        
        <!-- Add Tab Button/Form -->
        {#if showAddTabForm}
          <div class="add-tab-form">
            <div class="icon-picker">
              {#each TAB_ICONS as icon}
                <button 
                  class="icon-btn" 
                  class:selected={newSchemaTabIcon === icon}
                  on:click={() => newSchemaTabIcon = icon}
                >{icon}</button>
              {/each}
            </div>
            <input 
              type="text" 
              placeholder="Tab ID"
              bind:value={newSchemaTabId}
              class="tab-id-input"
            />
            <input 
              type="text" 
              placeholder="Label"
              bind:value={newSchemaTabLabel}
              class="tab-label-input"
              on:keypress={(e) => e.key === 'Enter' && handleAddTab()}
            />
            <button class="btn btn-sm btn-primary" on:click={handleAddTab}>Add</button>
            <button class="btn btn-sm btn-ghost" on:click={() => showAddTabForm = false}>×</button>
          </div>
        {:else}
          <button class="add-tab-btn" on:click={() => showAddTabForm = true}>
            <span>+</span> Add Tab
          </button>
        {/if}
      </div>
      
      <div class="modal-body schema-builder-body">
        <!-- Active Tab Header -->
        <div class="active-tab-header">
          {#if activeTab === 'default'}
            <h3>⚙️ Default</h3>
            <p class="tab-description">Fields shown in the default view. Create custom tabs to organize fields into sections.</p>
          {:else if activeTabData}
            <h3>{activeTabData.icon} {activeTabData.label}</h3>
            <p class="tab-description">Fields in this tab will appear under "{activeTabData.label}" in Cast Studio.</p>
          {/if}
        </div>
        
        <!-- Add New Field to Active Tab -->
        <div class="add-field-form">
          <input 
            type="text" 
            placeholder="Field key (e.g., message, fontSize)"
            bind:value={newFieldKey}
            on:keypress={(e) => e.key === 'Enter' && handleAddField()}
          />
          <select bind:value={newFieldType}>
            {#each FIELD_TYPES as ft}
              <option value={ft.value}>{ft.icon} {ft.label}</option>
            {/each}
          </select>
          <button class="btn btn-primary" on:click={handleAddField}>
            + Add to {activeTab === 'default' ? 'Default' : activeTabData?.label || 'Tab'}
          </button>
        </div>

        <!-- Fields for Active Tab -->
        <div class="schema-fields">
          {#if fieldsForActiveTab.length === 0}
            <div class="no-fields">
              <span class="no-fields-icon">{activeTab === 'default' ? '⚙️' : activeTabData?.icon || '📋'}</span>
              <p>No fields in this tab yet. Add one above.</p>
            </div>
          {:else}
            {#each fieldsForActiveTab as [key, field]}
              <div class="schema-field">
                <div class="field-header">
                  <span class="field-key">{key}</span>
                  <span class="field-type-badge">{FIELD_TYPES.find(t => t.value === field.type)?.icon || '📝'} {field.type}</span>
                  
                  <!-- Move to Tab dropdown -->
                  <select 
                    class="move-to-tab-select"
                    value={field.tab || 'default'}
                    on:change={(e) => handleMoveField(key, e.target.value)}
                    title="Move to tab"
                  >
                    <option value="default">⚙️ Default</option>
                    {#each editingSchemaTabs as tab}
                      <option value={tab.id}>{tab.icon} {tab.label}</option>
                    {/each}
                  </select>
                  
                  <button class="remove-field-btn" on:click={() => promptDeleteField(key)} title="Remove field">
                    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
                
                <div class="field-properties">
                  <div class="prop-row-compact">
                    <label>Label</label>
                    <input type="text" bind:value={field.label} on:input={() => handleFieldUpdate(key, field)} />
                  </div>
                  
                  <div class="prop-row-compact">
                    <label>Default</label>
                    {#if field.type === 'boolean'}
                      <input type="checkbox" bind:checked={field.default} on:change={() => handleFieldUpdate(key, field)} />
                    {:else if field.type === 'color'}
                      <input type="color" bind:value={field.default} on:input={() => handleFieldUpdate(key, field)} />
                    {:else if field.type === 'number' || field.type === 'slider'}
                      <input type="number" bind:value={field.default} on:input={() => handleFieldUpdate(key, field)} />
                    {:else}
                      <input type="text" bind:value={field.default} on:input={() => handleFieldUpdate(key, field)} />
                    {/if}
                  </div>

                  {#if field.type === 'slider'}
                    <div class="prop-row-compact">
                      <label>Min</label>
                      <input type="number" bind:value={field.min} on:input={() => handleFieldUpdate(key, field)} style="width: 80px" />
                    </div>
                    <div class="prop-row-compact">
                      <label>Max</label>
                      <input type="number" bind:value={field.max} on:input={() => handleFieldUpdate(key, field)} style="width: 80px" />
                    </div>
                    <div class="prop-row-compact">
                      <label>Step</label>
                      <input type="number" bind:value={field.step} on:input={() => handleFieldUpdate(key, field)} style="width: 80px" />
                    </div>
                    <div class="prop-row-compact">
                      <label>Unit</label>
                      <input type="text" bind:value={field.unit} placeholder="px, %, etc" on:input={() => handleFieldUpdate(key, field)} style="width: 60px" />
                    </div>
                  {/if}

                  {#if field.type === 'select'}
                    <div class="options-editor">
                      <label>Options</label>
                      <div class="options-list">
                        {#each (field.options || []) as opt, idx}
                          <div class="option-row">
                            <input type="text" placeholder="Value" bind:value={opt.value} on:input={() => handleFieldUpdate(key, field)} />
                            <input type="text" placeholder="Label" bind:value={opt.label} on:input={() => handleFieldUpdate(key, field)} />
                            <button class="remove-option-btn" on:click={() => handleRemoveFieldOption(key, idx)}>×</button>
                          </div>
                        {/each}
                        <button class="add-option-btn" on:click={() => handleAddFieldOption(key)}>+ Add Option</button>
                      </div>
                    </div>
                  {/if}

                  {#if type === 'style'}
                    <div class="prop-row-compact">
                      <label>Group</label>
                      <select bind:value={field.group} on:change={() => handleFieldUpdate(key, field)}>
                        {#each STYLE_GROUPS as g}
                          <option value={g.value}>{g.label}</option>
                        {/each}
                      </select>
                    </div>
                  {/if}
                </div>
              </div>
            {/each}
          {/if}
        </div>
      </div>
      <div class="modal-footer">
        <div class="footer-info">
          <span class="tab-count-info">{editingSchemaTabs.length} tab{editingSchemaTabs.length !== 1 ? 's' : ''}</span>
          <span class="field-count-info">{Object.keys(editingSchema).filter(k => k !== '_tabs').length} field{Object.keys(editingSchema).filter(k => k !== '_tabs').length !== 1 ? 's' : ''}</span>
        </div>
        <div class="footer-actions">
          <button class="btn btn-secondary" on:click={handleClose}>Cancel</button>
          <button class="btn btn-primary" on:click={handleSave}>Save Schema</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Delete Field Confirmation Modal -->
  {#if showDeleteFieldConfirm && fieldToDelete}
    <div class="confirm-overlay" on:click={cancelDeleteField}>
      <div class="confirm-modal confirm-modal-sm" on:click|stopPropagation>
        <div class="confirm-header">
          <span class="confirm-icon">🗑️</span>
          <h3>Delete Field "{fieldToDelete.label}"?</h3>
        </div>
        <div class="confirm-body">
          <p>Are you sure you want to delete the <strong>{fieldToDelete.key}</strong> field? This cannot be undone.</p>
        </div>
        <div class="confirm-footer">
          <button class="btn btn-secondary" on:click={cancelDeleteField}>Cancel</button>
          <button class="btn btn-danger" on:click={confirmDeleteField}>Delete Field</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Delete Tab Confirmation Modal -->
  {#if showDeleteConfirm && tabToDelete}
    <div class="confirm-overlay" on:click={cancelDeleteTab}>
      <div class="confirm-modal" on:click|stopPropagation>
        <div class="confirm-header">
          <span class="confirm-icon">⚠️</span>
          <h3>Delete Tab "{tabToDelete.label}"?</h3>
        </div>
        <div class="confirm-body">
          <p>This tab contains <strong>{tabToDelete.fieldCount} field{tabToDelete.fieldCount !== 1 ? 's' : ''}</strong>. What would you like to do with them?</p>
          
          <div class="confirm-options">
            <label class="confirm-option" class:selected={deleteAction === 'move'}>
              <input type="radio" bind:group={deleteAction} value="move" />
              <div class="option-content">
                <span class="option-icon">📦</span>
                <div>
                  <strong>Move fields to another tab</strong>
                  <p>Keep the fields and move them to:</p>
                  <select bind:value={moveToTab} disabled={deleteAction !== 'move'}>
                    {#each availableMoveTabs as tab}
                      <option value={tab.id}>{tab.icon} {tab.label}</option>
                    {/each}
                  </select>
                </div>
              </div>
            </label>
            
            <label class="confirm-option" class:selected={deleteAction === 'delete'}>
              <input type="radio" bind:group={deleteAction} value="delete" />
              <div class="option-content">
                <span class="option-icon">🗑️</span>
                <div>
                  <strong>Delete all fields</strong>
                  <p>Permanently remove all {tabToDelete.fieldCount} field{tabToDelete.fieldCount !== 1 ? 's' : ''} in this tab</p>
                </div>
              </div>
            </label>
          </div>
        </div>
        <div class="confirm-footer">
          <button class="btn btn-secondary" on:click={cancelDeleteTab}>Cancel</button>
          <button class="btn" class:btn-primary={deleteAction === 'move'} class:btn-danger={deleteAction === 'delete'} on:click={confirmDeleteTab}>
            {deleteAction === 'move' ? 'Move & Delete Tab' : 'Delete All'}
          </button>
        </div>
      </div>
    </div>
  {/if}
{/if}

<style>
  /* Modal Styles */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 24px;
  }

  .modal {
    background: #1a1a2e;
    border-radius: 16px;
    max-width: 400px;
    width: 100%;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }

  .modal.modal-xl {
    max-width: 800px;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 24px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .modal-header h2 {
    font-size: 18px;
    font-weight: 600;
    margin: 0;
  }

  .close-btn {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .close-btn:hover {
    background: rgba(255, 255, 255, 0.2);
    color: #fff;
  }

  .close-btn svg {
    width: 18px;
    height: 18px;
  }

  .modal-body {
    padding: 24px;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding: 16px 24px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(0, 0, 0, 0.2);
    border-radius: 0 0 16px 16px;
  }

  .btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border-radius: 6px;
    border: none;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: #667eea;
    color: #fff;
  }

  .btn-primary:hover:not(:disabled) {
    background: #5a67d8;
  }

  .btn-secondary {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  .btn-secondary:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.15);
  }

  .btn-sm {
    padding: 4px 10px;
    font-size: 11px;
  }

  .btn-ghost {
    background: transparent;
    color: rgba(255, 255, 255, 0.6);
  }

  .btn-ghost:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  /* Schema Builder Styles */
  .schema-builder-body {
    max-height: 60vh;
    overflow-y: auto;
  }

  .active-tab-header {
    margin-bottom: 20px;
    padding-bottom: 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .active-tab-header h3 {
    margin: 0 0 4px;
    font-size: 16px;
  }

  .tab-description {
    margin: 0;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.5);
  }

  .add-field-form {
    display: flex;
    gap: 8px;
    margin-bottom: 20px;
  }

  .add-field-form input {
    flex: 1;
    padding: 10px 12px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
    font-size: 13px;
  }

  .add-field-form select {
    padding: 10px 12px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
    font-size: 13px;
  }

  .add-field-form select option {
    background: #1a1a2e;
  }

  .schema-tab-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 16px;
    background: rgba(0, 0, 0, 0.3);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    flex-wrap: wrap;
  }

  .schema-tab-item {
    position: relative;
    display: flex;
    align-items: center;
    border-radius: 6px 6px 0 0;
    overflow: hidden;
  }

  .schema-tab-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    font-size: 12px;
    border-bottom: 2px solid transparent;
    transition: all 0.2s;
  }

  .schema-tab-item.active .schema-tab-btn,
  .schema-tab-btn.default-tab.active {
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
    border-bottom-color: #667eea;
  }

  .schema-tab-btn:hover {
    background: rgba(255, 255, 255, 0.03);
    color: #fff;
  }

  .tab-count {
    background: rgba(255, 255, 255, 0.1);
    padding: 1px 5px;
    border-radius: 10px;
    font-size: 10px;
  }

  /* Tab Actions Hover */
  .tab-actions {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    background: rgba(26, 26, 46, 0.95);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s;
  }

  .schema-tab-item:hover .tab-actions {
    opacity: 1;
    pointer-events: auto;
  }

  .tab-action-btn {
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: rgba(255, 255, 255, 0.4);
    cursor: pointer;
    font-size: 14px;
    font-weight: bold;
    margin-left: -4px;
    margin-right: 4px;
    transition: all 0.15s;
  }

  .tab-action-btn:hover {
    background: rgba(255, 255, 255, 0.15);
    color: #fff;
  }

  .tab-action-btn.tab-delete:hover {
    background: rgba(239, 68, 68, 0.3);
    color: #ef4444;
  }

  /* Add Tab Form */
  .add-tab-btn {
    padding: 6px 10px;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.5);
    border: 1px dashed rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    background: transparent;
    cursor: pointer;
  }

  .add-tab-btn:hover {
    border-color: rgba(255, 255, 255, 0.4);
    color: #fff;
  }

  .add-tab-form {
    display: flex;
    align-items: center;
    gap: 4px;
    background: #1a1a2e;
    padding: 4px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.2);
  }

  .add-tab-form .icon-picker {
    display: flex;
    gap: 2px;
    max-width: 100px;
    overflow-x: auto;
    padding-bottom: 2px;
  }

  .add-tab-form .icon-btn {
    padding: 2px;
    font-size: 12px;
    border: none;
    background: transparent;
    cursor: pointer;
    border-radius: 2px;
    opacity: 0.5;
  }

  .add-tab-form .icon-btn:hover,
  .add-tab-form .icon-btn.selected {
    opacity: 1;
    background: rgba(255, 255, 255, 0.1);
  }

  .add-tab-form .tab-id-input,
  .add-tab-form .tab-label-input {
    width: 80px;
    padding: 4px 6px;
    font-size: 11px;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #fff;
    border-radius: 2px;
  }

  /* Fields */
  .schema-fields {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .no-fields {
    text-align: center;
    padding: 40px;
    background: rgba(255, 255, 255, 0.02);
    border-radius: 8px;
    border: 1px dashed rgba(255, 255, 255, 0.1);
  }

  .no-fields-icon {
    font-size: 24px;
    margin-bottom: 8px;
    display: block;
    opacity: 0.5;
  }

  .no-fields p {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.4);
    margin: 0;
  }

  .schema-field {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 6px;
    overflow: hidden;
  }

  .field-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.03);
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  .field-key {
    font-family: monospace;
    font-size: 12px;
    color: #fff;
    font-weight: 500;
    flex: 1;
  }

  .field-type-badge {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.6);
  }

  .move-to-tab-select {
    padding: 4px 8px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    border-radius: 4px;
    font-size: 11px;
    transition: all 0.2s;
  }
  
  .move-to-tab-select:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.3);
    color: #fff;
  }

  .move-to-tab-select option {
    background: #1a1a2e;
    color: #fff;
  }

  .remove-field-btn {
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.4);
    cursor: pointer;
    border-radius: 4px;
  }

  .remove-field-btn:hover {
    background: rgba(239, 68, 68, 0.2);
    color: #ef4444;
  }

  .remove-field-btn svg {
    width: 14px;
    height: 14px;
  }

  .field-properties {
    padding: 12px;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  .prop-row-compact {
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(0, 0, 0, 0.2);
    padding: 4px 8px;
    border-radius: 4px;
  }

  .prop-row-compact label {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.5);
  }

  .prop-row-compact input,
  .prop-row-compact select {
    background: transparent;
    border: none;
    color: #fff;
    font-size: 12px;
    outline: none;
    min-width: 60px;
  }

  .prop-row-compact input[type="color"] {
    width: 20px;
    height: 20px;
    padding: 0;
    min-width: 20px;
  }

  .options-editor {
    width: 100%;
    margin-top: 4px;
  }

  .options-editor label {
    display: block;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.5);
    margin-bottom: 4px;
  }

  .options-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .option-row {
    display: flex;
    gap: 4px;
  }

  .option-row input {
    flex: 1;
    padding: 4px 8px;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #fff;
    font-size: 11px;
  }

  .remove-option-btn {
    width: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.4);
    cursor: pointer;
    border-radius: 4px;
  }

  .remove-option-btn:hover {
    background: rgba(239, 68, 68, 0.2);
    color: #ef4444;
  }

  .add-option-btn {
    padding: 4px;
    font-size: 11px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px dashed rgba(255, 255, 255, 0.2);
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
    border-radius: 4px;
  }

  .add-option-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  .footer-info {
    display: flex;
    gap: 12px;
    margin-right: auto;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.4);
  }

  .footer-actions {
    display: flex;
    gap: 8px;
  }

  /* Delete Confirmation Modal */
  .confirm-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1100;
  }

  .confirm-modal {
    background: #1a1a2e;
    border-radius: 12px;
    width: 100%;
    max-width: 420px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .confirm-modal.confirm-modal-sm {
    max-width: 340px;
  }

  .confirm-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .confirm-icon {
    font-size: 24px;
  }

  .confirm-header h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  .confirm-body {
    padding: 20px;
  }

  .confirm-body > p {
    margin: 0 0 16px;
    font-size: 14px;
    color: rgba(255, 255, 255, 0.8);
  }

  .confirm-options {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .confirm-option {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .confirm-option:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .confirm-option.selected {
    background: rgba(102, 126, 234, 0.1);
    border-color: rgba(102, 126, 234, 0.4);
  }

  .confirm-option input[type="radio"] {
    margin-top: 4px;
    accent-color: #667eea;
  }

  .option-content {
    display: flex;
    gap: 12px;
    flex: 1;
  }

  .option-icon {
    font-size: 20px;
  }

  .option-content div {
    flex: 1;
  }

  .option-content strong {
    display: block;
    font-size: 13px;
    margin-bottom: 4px;
  }

  .option-content p {
    margin: 0;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
  }

  .option-content select {
    margin-top: 8px;
    padding: 6px 10px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    color: #fff;
    font-size: 12px;
    width: 100%;
  }

  .option-content select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .option-content select option {
    background: #1a1a2e;
  }

  .confirm-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 16px 20px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(0, 0, 0, 0.2);
    border-radius: 0 0 12px 12px;
  }

  .btn-danger {
    background: #ef4444;
    color: #fff;
  }

  .btn-danger:hover:not(:disabled) {
    background: #dc2626;
  }
</style>
