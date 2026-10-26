<script setup lang="ts">
import { computed, nextTick, ref, watch, watchEffect } from 'vue';
import { storeToRefs } from 'pinia';
import { useGraphStore, useEditorStore } from '@/store';
import { useAppI18n } from '@/composables/useAppI18n';
const { t } = useAppI18n();
import type { Question, QuestionType, Option } from '@/types/runtime';
import { v4 as uuidv4 } from 'uuid';
import { 
  Type, 
  AlignLeft, 
  List, 
  CheckSquare, 
  Hash, 
  Calendar, 
  Info, 
  HelpCircle,
  Plus,
  Trash2,
  X,
  Globe
} from 'lucide-vue-next';

// Stores
const graphStore = useGraphStore();
const editorStore = useEditorStore();

const { selectedNodeId, currentLocale } = storeToRefs(editorStore);
const { defaultLocale } = storeToRefs(graphStore);

// Ref to the scrollable inspector content container
const inspectorContentRef = ref<HTMLElement | null>(null);

// Scroll to a section when requested from ProblemsPanel
watch(() => editorStore.inspectorScrollToSection, async (section) => {
  if (!section) return;
  // Double nextTick: first tick applies node selection re-render, second ensures DOM is ready
  await nextTick();
  await nextTick();
  const el = inspectorContentRef.value?.querySelector(`[data-section="${section}"]`) as HTMLElement | null;
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('section-highlight');
    setTimeout(() => el.classList.remove('section-highlight'), 1200);
  }
  editorStore.requestInspectorSection(null);
});

// Question Type Icons Mapping
const questionTypeIcons: Record<QuestionType, any> = {
  textzeile: Type,
  textbox: AlignLeft,
  select: List,
  checkbox: CheckSquare,
  int: Hash,
  date: Calendar,
  info: Info,
};



// Type icon/label getters
function getTypeIcon(type: QuestionType) {
  return questionTypeIcons[type] || HelpCircle;
}

// Selected node
const selectedNode = computed(() => {
  if (!selectedNodeId.value) return null;
  return graphStore.getNode(selectedNodeId.value);
});

const selectedQuestion = computed(() => selectedNode.value?.data || null);
const questionType = computed<QuestionType | null>(() => selectedQuestion.value?.type || null);

// Editing state for options
const editingOptionId = ref<string | null>(null);

// Migrate legacy UUID-based containsAny/containsAll to option values when a node is selected
watch(selectedNodeId, (nodeId) => {
  if (!nodeId) return;
  const q = graphStore.getNode(nodeId)?.data;
  if (!q?.actions?.length || !q?.options?.length) return;

  // Build id→value map for options that have UUIDs as id
  const idToValue = new Map<string, string>();
  for (const opt of q.options) {
    if (opt.id && opt.id !== opt.value) idToValue.set(opt.id, opt.value);
  }
  if (idToValue.size === 0) return;

  let changed = false;
  const actions = JSON.parse(JSON.stringify(q.actions));
  for (const action of actions) {
    for (const key of ['containsAny', 'containsAll'] as const) {
      if (!Array.isArray(action.when?.[key])) continue;
      action.when[key] = action.when[key].map((v: string) => idToValue.get(v) ?? v);
      changed = true;
    }
  }
  if (changed) graphStore.updateNode(nodeId, { actions });
});
const duplicateOptionValues = computed<Set<string>>(() => {
  const opts = selectedQuestion.value?.options ?? [];
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const o of opts) {
    if (seen.has(o.value)) dupes.add(o.value);
    else seen.add(o.value);
  }
  return dupes;
});

// Get list of all locales with missing translations for current question
const missingTranslationLocales = computed(() => {
  if (!selectedQuestion.value) return [];
  const q = selectedQuestion.value;
  const supportedLocales = graphStore.supportedLocales;
  const missing: string[] = [];
  
  for (const locale of supportedLocales) {
    let hasMissing = false;
    
    // Check text fields
    const textFields = ['label', 'description', 'placeholder'];
    for (const field of textFields) {
      const value = (q as unknown as Record<string, unknown>)[field];
      if (typeof value === 'object' && value !== null) {
        const localeMap = value as Record<string, string>;
        // If locale entry is empty/missing
        if (!localeMap[locale]) {
          // Check if ANY other locale has content
          const otherHasContent = Object.entries(localeMap).some(([l, v]) => l !== locale && v && v.trim() !== '');
          if (otherHasContent) hasMissing = true;
        }
      }
    }
    
    // Check options
    if (q.options && Array.isArray(q.options)) {
      for (const opt of q.options) {
        const val = opt.label;
        if (typeof val === 'object' && val !== null) {
          const localeMap = val as Record<string, string>;
          // If locale entry is missing/empty
          if (!localeMap[locale]) {
            // Check if ANY other locale has content
            const otherHasContent = Object.entries(localeMap).some(([l, v]) => l !== locale && v && v.trim() !== '');
            if (otherHasContent) hasMissing = true;
          }
        }
      }
    }

    if (hasMissing) missing.push(locale);
  }
  
  return missing;
});

const hasMissingTranslations = computed(() => missingTranslationLocales.value.length > 0);

// Get list of locales missing images (separate from text translations)
const missingImageLocales = computed(() => {
  if (!selectedQuestion.value) return [];
  const q = selectedQuestion.value;
  const supportedLocales = graphStore.supportedLocales;
  const missing: string[] = [];
  
  const image = q.image;
  // Only check if user has started adding an image (it exists as object/string)
  // If no image at all, it's not "missing" translations, just no image.
  if (image && typeof image !== 'string') {
    if (typeof image.src === 'object' && image.src !== null) {
       for (const locale of supportedLocales) {
         let val = image.src[locale];
         if (!val || val === '') {
           missing.push(locale);
         }
       }
    }
  }
  
  return missing;
});

// Locales that HAVE an image (potential sources)
const imageSourceLocales = computed(() => {
  if (!selectedQuestion.value) return [];
  const supportedLocales = graphStore.supportedLocales;
  const image = selectedQuestion.value.image;
  
  if (!image || typeof image === 'string' || typeof image.src !== 'object') return [];
  
  return supportedLocales.filter(l => (image.src as Record<string, string>)?.[l] && (image.src as Record<string, string>)[l] !== '');
});

// Selected source for adoption (default to defaultLocale if available, else first source)
const selectedImageSource = ref<string>('');
// Update selected source when available sources change
watchEffect(() => {
  const sources = imageSourceLocales.value;
  if (sources.includes(graphStore.defaultLocale)) {
    selectedImageSource.value = graphStore.defaultLocale;
  } else if (sources.length > 0) {
    selectedImageSource.value = sources[0]!;
  } else {
    selectedImageSource.value = '';
  }
});


// Update question field with i18n handling
// For localized fields: always update ONLY the current locale
// Other locales get empty string if not existing
function updateField(field: string, value: unknown) {
  if (!selectedNodeId.value || !selectedQuestion.value) return;
  
  // Localizable string fields
  const localizableFields = ['label', 'placeholder', 'description'];
  
  if (localizableFields.includes(field) && typeof value === 'string') {
    const currentValue = (selectedQuestion.value as unknown as Record<string, unknown>)[field];
    const supportedLocales = graphStore.supportedLocales;
    
    // Build locale map - only update current locale
    let localeMap: Record<string, string> = {};
    
    // Initialize with existing values or empty strings
    for (const locale of supportedLocales) {
      if (typeof currentValue === 'object' && currentValue !== null) {
        localeMap[locale] = (currentValue as Record<string, string>)[locale] || '';
      } else if (typeof currentValue === 'string') {
        // Converting from string - current locale gets the old value
        localeMap[locale] = locale === currentLocale.value ? value : currentValue;
      } else {
        localeMap[locale] = '';
      }
    }
    
    // Update current locale with new value
    localeMap[currentLocale.value] = value;
    
    graphStore.updateNode(selectedNodeId.value, { [field]: localeMap });
  } else {
    // Non-localizable fields - update directly
    graphStore.updateNode(selectedNodeId.value, { [field]: value });
  }
}

// Update nested field
function updateNestedField(path: string[], value: unknown) {
  if (!selectedNodeId.value || !selectedQuestion.value) return;

  const question = { ...selectedQuestion.value } as Record<string, unknown>;
  let current: Record<string, unknown> = question;

  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (key && !current[key]) {
      current[key] = {};
    }
    if (key) {
      current = current[key] as Record<string, unknown>;
    }
  }

  const lastKey = path[path.length - 1];
  if (lastKey) {
    current[lastKey] = value;
  }

  // If a nested object (e.g. validation) only contains undefined values → remove it
  if (path.length > 1) {
    const parentKey = path[path.length - 2];
    if (parentKey) {
      const parentObj = question[parentKey] as Record<string, unknown>;
      if (parentObj && Object.values(parentObj).every(v => v === undefined)) {
        question[parentKey] = undefined;
      }
    }
  }

  graphStore.updateNode(selectedNodeId.value, question as Partial<Question>);
}

// Get localized label - NO fallback, returns current locale only
function getLabel(question: Question): string {
  const label = question.label;
  if (!label) return '';
  if (typeof label === 'string') return label;
  // Return only current locale's value - no fallback
  return label[currentLocale.value] || '';
}

// Get resolved locale value - NO fallback, returns current locale only
function getResolvedValue(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  const localeMap = value as Record<string, string>;
  // Return only current locale's value - no fallback
  return localeMap[currentLocale.value] || '';
}

// Delete node handler
function deleteSelectedNode() {
  const node = selectedNode.value;
  if (node && node.id !== '__start__' && node.id !== '__end__') {
    graphStore.removeNode(node.id);
    editorStore.clearSelection();
  }
}

// Change question type
function changeQuestionType(newType: QuestionType) {
  if (!selectedNodeId.value || !selectedNode.value || !selectedQuestion.value) return;

  const node = selectedNode.value;
  node.questionType = newType;

  const updates: Partial<Question> = { type: newType };

  // placeholder: only for textzeile / textbox
  if (newType !== 'textzeile' && newType !== 'textbox') {
    updates.placeholder = undefined;
  }

  // options: only for select / checkbox
  if (newType === 'select' || newType === 'checkbox') {
    if (!selectedQuestion.value.options) updates.options = [];
  } else {
    updates.options = undefined;
  }

  // required: not for info questions
  if (newType === 'info') {
    updates.required = undefined;
  }

  // validation: typ-spezifische Felder bereinigen
  const currentValidation = selectedQuestion.value.validation ?? {};
  const hasTextValidation = newType === 'textzeile' || newType === 'textbox';
  const hasNumberValidation = newType === 'int';
  const hasDateValidation = newType === 'date';
  const hasCheckboxValidation = newType === 'checkbox';

  updates.validation = {
    ...currentValidation,
    minLength: hasTextValidation ? currentValidation.minLength : undefined,
    maxLength: hasTextValidation ? currentValidation.maxLength : undefined,
    pattern: hasTextValidation ? currentValidation.pattern : undefined,
    min: (hasNumberValidation || hasDateValidation) ? currentValidation.min : undefined,
    max: (hasNumberValidation || hasDateValidation) ? currentValidation.max : undefined,
    maxSelections: hasCheckboxValidation ? currentValidation.maxSelections : undefined,
  };

  // Do not persist an empty validation object
  if (Object.values(updates.validation).every(v => v === undefined)) {
    updates.validation = undefined;
  }

  graphStore.updateNode(selectedNodeId.value, updates);
}

// ============================================================================
// Options Management
// ============================================================================

function addOption() {
  if (!selectedQuestion.value || !selectedNodeId.value) return;
  
  const newOption: Option = {
    id: uuidv4(),
    label: 'New Option',
    value: `option_${Date.now()}`,
  };
  
  const currentOptions = selectedQuestion.value.options || [];
  graphStore.updateNode(selectedNodeId.value, {
    options: [...currentOptions, newOption]
  });
  editingOptionId.value = newOption.id;
}

function updateOption(optionId: string, field: keyof Option, value: unknown) {
  if (!selectedQuestion.value || !selectedNodeId.value) return;

  const options = selectedQuestion.value.options?.map(opt => {
    if (opt.id === optionId) {
      // Handle localized label
      if (field === 'label' && typeof value === 'string') {
        const currentLabel = opt.label;
        const supportedLocales = graphStore.supportedLocales;
        let localeMap: Record<string, string> = {};

        // Initialize map
        for (const locale of supportedLocales) {
           if (typeof currentLabel === 'object' && currentLabel !== null) {
              localeMap[locale] = (currentLabel as Record<string, string>)[locale] || '';
           } else if (typeof currentLabel === 'string') {
              // If it was a string, assign it to current locale (or all? usually migration implies preserving for primary, but here we just assign to current if we are editing in current)
              // Better: Assign old string to ALL locales if we are migrating, OR assign to default, but to avoid data loss let's key it to current.
              // Actually, if we are editing, we want to update the CURRENT locale. The OLD value should be preserved for others? 
              // If it was a string 'Foo', and we are in 'en', we want 'en': 'NewFoo'. What about 'de'? 'de' should probably be 'Foo' (the old value).
              localeMap[locale] = locale === currentLocale.value ? value : currentLabel; 
           } else {
              localeMap[locale] = '';
           }
        }
        
        // Update current locale
        localeMap[currentLocale.value] = value;
        return { ...opt, label: localeMap };
      }
      
      return { ...opt, [field]: value };
    }
    return opt;
  }) || [];
  
  graphStore.updateNode(selectedNodeId.value, { options });
}

function deleteOption(optionId: string) {
  if (!selectedQuestion.value || !selectedNodeId.value) return;

  const options = selectedQuestion.value.options?.filter(opt => opt.id !== optionId) || [];
  graphStore.updateNode(selectedNodeId.value, { options });

  if (editingOptionId.value === optionId) editingOptionId.value = null;
}

function moveOptionUp(index: number) {
  if (!selectedQuestion.value || !selectedNodeId.value || index === 0) return;
  
  const options = [...(selectedQuestion.value.options || [])];
  const current = options[index];
  const prev = options[index - 1];
  if (!current || !prev) return;
  [options[index - 1], options[index]] = [current, prev];
  
  graphStore.updateNode(selectedNodeId.value, { options });
}

function moveOptionDown(index: number) {
  if (!selectedQuestion.value || !selectedNodeId.value) return;
  const options = [...(selectedQuestion.value.options || [])];
  if (index >= options.length - 1) return;
  const current = options[index];
  const next = options[index + 1];
  if (!current || !next) return;
  
  [options[index], options[index + 1]] = [next, current];
  
  graphStore.updateNode(selectedNodeId.value, { options });
}

async function toggleOptionNext(optionId: string) {
  if (!selectedQuestion.value || !selectedNodeId.value) return;

  const wasEnabled = selectedQuestion.value.options?.find(o => o.id === optionId)?.next !== undefined;

  const options = selectedQuestion.value.options?.map(opt => {
    if (opt.id === optionId) {
      // Toggle: if has next, remove it; if no next, add placeholder
      if (opt.next) {
        const { next, ...rest } = opt;
        return rest;
      } else {
        return { ...opt, next: 'submit' };
      }
    }
    return opt;
  }) || [];

  graphStore.updateNode(selectedNodeId.value, { options });

  // If we just disabled routing, remove the Rete connection from this option's port
  if (wasEnabled) {
    const sourcePort = `option_${optionId}`;
    const storeEdge = graphStore.edges.find(
      (e: any) => e.source === selectedNodeId.value && e.sourcePort === sourcePort
    );
    if (storeEdge) {
      graphStore.removeEdge(storeEdge.id);
      if (editorStore.reteEditor) {
        const reteConns = Array.from(editorStore.reteEditor.getConnections()) as any[];
        const reteConn = reteConns.find(
          (c: any) => c.source === selectedNodeId.value && c.sourceOutput === sourcePort
        );
        if (reteConn) {
          await editorStore.reteEditor.removeConnection(reteConn.id);
        }
      }
    }
  }
}

// ============================================================================
// Image Handling
// ============================================================================

function getImageSrc(image: string | { src?: string | Record<string, string>; url?: string | Record<string, string> } | undefined): string {
  if (!image) return '';
  if (typeof image === 'string') return image;
  
  // Return ONLY current locale's image - no fallback to other locales
  if (image.src) {
    if (typeof image.src === 'string') return image.src;
    let src = image.src[currentLocale.value] || '';
    
    // Resolve @link:LOCALE
    if (src.startsWith('@link:')) {
      const targetLocale = src.substring(6);
      return image.src[targetLocale] || '';
    }
    return src;
  }
  // Then url
  if (image.url) {
    if (typeof image.url === 'string') return image.url;
    return image.url[currentLocale.value] || '';
  }
  return '';
}

function getImagePlacement(image: string | { placement?: 'before' | 'after' } | undefined): 'before' | 'after' {
  if (!image || typeof image === 'string') return 'before';
  return image.placement || 'before';
}

function getImageAlt(image: any): string {
  if (!image || typeof image === 'string') return '';
  if (!image.alt) return '';
  if (typeof image.alt === 'string') return image.alt;
  return image.alt[currentLocale.value] || '';
}

function getImageMaxHeight(image: any): number | undefined {
  if (!image || typeof image === 'string') return undefined;
  return image.maxHeight;
}

function getImageFit(image: any): string {
  if (!image || typeof image === 'string') return 'contain';
  return image.fit || 'contain';
}

function handleImageError(e: Event) {
  const target = e.target as HTMLImageElement;
  target.style.display = 'none';
}

/**
 * Link current locale's image to another locale's image to avoid duplication.
 */
function linkImageFrom(targetLocale: string) {
  if (!selectedNodeId.value || !selectedQuestion.value) return;
  const currentImage = selectedQuestion.value.image;
  
  if (currentImage && typeof currentImage !== 'string' && typeof currentImage.src === 'object') {
     const newSrc = { ...currentImage.src };
     // Set current locale to reference target
     newSrc[currentLocale.value] = `@link:${targetLocale}`;
     updateField('image', { ...currentImage, src: newSrc });
  }
}

/**
 * Compress image using Canvas (max 1024px, WebP 0.8)
 */
function compressImage(variableFile: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(variableFile);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target?.result as string;
            img.onload = () => {
                const MAX_WIDTH = 1024;
                const MAX_HEIGHT = 1024;
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > MAX_WIDTH) {
                        height *= MAX_WIDTH / width;
                        width = MAX_WIDTH;
                    }
                } else {
                    if (height > MAX_HEIGHT) {
                        width *= MAX_HEIGHT / height;
                        height = MAX_HEIGHT;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error("Canvas context not available"));
                    return;
                }
                ctx.drawImage(img, 0, 0, width, height);
                // Compress to WebP with 0.8 quality
                const dataUrl = canvas.toDataURL('image/webp', 0.8);
                resolve(dataUrl);
            };
            img.onerror = (err) => reject(err);
        };
        reader.onerror = (err) => reject(err);
    });
}

const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_IMAGE_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

function handleImageUpload(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || !selectedNodeId.value) return;

  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    alert(t('inspector.imageTypeRejected'));
    input.value = '';
    return;
  }
  if (file.size > MAX_IMAGE_FILE_SIZE) {
    alert(t('inspector.imageTooLarge'));
    input.value = '';
    return;
  }

  compressImage(file).then((base64) => {
      const existingImage = selectedQuestion.value?.image;
      const supportedLocales = graphStore.supportedLocales;
      
      // Build src locale map
      let newSrc: Record<string, string> = {};
      
      // 1. Populate existing values
      for (const locale of supportedLocales) {
        if (existingImage && typeof existingImage !== 'string' && typeof existingImage.src === 'object') {
          newSrc[locale] = existingImage.src[locale] || '';
        } else {
          newSrc[locale] = '';
        }
      }
      
      // 2. Check for duplication (Auto-Link)
      let isDuplicate = false;
      let linkTarget = '';
      
      for (const [loc, existingBase64] of Object.entries(newSrc)) {
        if (loc !== currentLocale.value && existingBase64 === base64) {
          isDuplicate = true;
          linkTarget = loc;
          break;
        }
      }
      
      if (isDuplicate) {
        newSrc[currentLocale.value] = `@link:${linkTarget}`;
      } else {
        newSrc[currentLocale.value] = base64;
      }
      
      // Build alt locale map
      let newAlt: Record<string, string> = {};
      for (const locale of supportedLocales) {
        if (existingImage && typeof existingImage !== 'string' && typeof existingImage.alt === 'object') {
          newAlt[locale] = existingImage.alt[locale] || '';
        } else {
          newAlt[locale] = '';
        }
      }
      
      updateField('image', {
        src: newSrc,
        alt: newAlt,
        placement: existingImage && typeof existingImage !== 'string' ? existingImage.placement : 'before',
        maxHeight: existingImage && typeof existingImage !== 'string' ? existingImage.maxHeight : undefined,
        fit: existingImage && typeof existingImage !== 'string' ? existingImage.fit : 'contain'
      });
  }).catch(err => {
      console.error("Image compression failed", err);
      alert(t('inspector.imageProcessFailed'));
  });
  
  // Reset input for re-upload
  input.value = '';
}

function updateImageAlt(altText: string) {
  if (!selectedQuestion.value || !selectedNodeId.value) return;
  
  const currentImage = selectedQuestion.value.image;
  if (!currentImage || typeof currentImage === 'string') return;
  
  const existingAlt = currentImage.alt;
  const supportedLocales = graphStore.supportedLocales;
  
  // Build alt locale map - only update current locale
  let newAlt: Record<string, string> = {};
  for (const locale of supportedLocales) {
    if (typeof existingAlt === 'object' && existingAlt !== null) {
      newAlt[locale] = existingAlt[locale] || '';
    } else {
      newAlt[locale] = '';
    }
  }
  // Update current locale
  newAlt[currentLocale.value] = altText;
  
  updateField('image', { ...currentImage, alt: newAlt });
}

function updateImageField(field: string, value: any) {
  if (!selectedQuestion.value || !selectedNodeId.value) return;
  
  const currentImage = selectedQuestion.value.image;
  if (typeof currentImage === 'string') {
    updateField('image', { src: { [currentLocale.value]: currentImage }, [field]: value });
  } else if (currentImage) {
    updateField('image', { ...currentImage, [field]: value });
  }
}

function removeImage() {
  if (!selectedNodeId.value || !selectedQuestion.value) return;
  
  const currentImage = selectedQuestion.value.image;
  // If it's a simple string or undefined, just remove it entirely (legacy/fallback)
  if (!currentImage || typeof currentImage === 'string') {
     updateField('image', undefined);
     return;
  }
  
  // Object structure handling
  const srcMap = typeof currentImage.src === 'object' ? { ...currentImage.src } : {};
  const altMap = typeof currentImage.alt === 'object' ? { ...currentImage.alt } : {};
  const currentVal = srcMap[currentLocale.value];
  
  // Logic: 
  // 1. If we are deleting a BLOB (Source), check if others link to us.
  // 2. If yes, move the blob to the first dependent, and update others to link to new master.

  if (currentVal && !currentVal.startsWith('@link:')) {
      // Find dependents (locales that link to current)
      const dependents = Object.entries(srcMap)
          .filter(([_loc, val]) => val === `@link:${currentLocale.value}`)
          .map(([loc]) => loc);
          
          if (dependents.length > 0) {
          const newMaster = dependents[0]!;
          // Move the blob to new master
          srcMap[newMaster] = currentVal;
          // Redirect other dependents to new master
          dependents.slice(1).forEach(dep => {
              srcMap[dep] = `@link:${newMaster}`;
          });
      }
  }
  
  // Clear current locale
  srcMap[currentLocale.value] = '';
  altMap[currentLocale.value] = '';
  
  // If all are empty, maybe remove the image object entirely? 
  // For now, keep the object but empty src to allow re-upload or keep other locales.
  
  updateField('image', { ...currentImage, src: srcMap, alt: altMap });
}

// Copy current locale's image (src and alt) to all MISSING locales as links
function copyImageToAllLocales() {
  if (!selectedQuestion.value || !selectedNodeId.value) return;
  
  const currentImage = selectedQuestion.value.image;
  if (!currentImage || typeof currentImage === 'string') return;
  
  const existingSrc = currentImage.src;
  const supportedLocales = graphStore.supportedLocales;
  
  if (typeof existingSrc !== 'object' || !existingSrc) return;
  
  // Build src locale map
  let newSrc: Record<string, string> = { ...existingSrc };
  
  // Only fill MISSING locales
  for (const locale of supportedLocales) {
    if (locale !== currentLocale.value) {
       // If empty or non-existent
       if (!newSrc[locale] || newSrc[locale] === '') {
           newSrc[locale] = `@link:${currentLocale.value}`;
       }
    }
  }
  
  // Copy Alt Text (Placeholder logic) - ONLY if missing
  let newAlt: Record<string, string> = {};
  if (currentImage.alt && typeof currentImage.alt === 'object') {
     newAlt = { ...currentImage.alt };
     const currentAltText = currentImage.alt[currentLocale.value] || '';
     for (const locale of supportedLocales) {
       if (locale !== currentLocale.value && (!newAlt[locale] || newAlt[locale] === '')) {
         newAlt[locale] = currentAltText; 
       }
     }
  }

  updateField('image', { ...currentImage, src: newSrc, alt: newAlt });
}

// Fill missing translations from Default Locale
function fillMissingTranslations() {
  if (!selectedQuestion.value || !selectedNodeId.value) return;
  
  const q = selectedQuestion.value;
  const defLocale = defaultLocale.value;
  
  // Identify target locales: those in the missing list
  // The user interaction assumes we want to fix the "Warning" languages.
  const targetLocales = missingTranslationLocales.value;
  if (targetLocales.length === 0) return;
  
  const updates: Record<string, unknown> = {};
  let hasUpdates = false;

  // 1. Text Fields
  const textFields = ['label', 'description', 'placeholder'];
  for (const field of textFields) {
    const val = (q as unknown as Record<string, unknown>)[field];
    if (typeof val === 'object' && val !== null) {
      const map = { ...(val as Record<string, string>) };
      const defValue = map[defLocale];
      
      // Only proceed if we HAVE a default value to copy from
      if (defValue && defValue.trim() !== '') {
        let fieldChanged = false;
        
        for (const target of targetLocales) {
          // If target is missing or empty
          if (!map[target] || map[target].trim() === '') {
            map[target] = defValue;
            fieldChanged = true;
          }
        }
        
        if (fieldChanged) {
          updates[field] = map;
          hasUpdates = true;
        }
      }
    }
  }
  
  // 2. Image
  const image = q.image;
  if (image && typeof image !== 'string') {
    let imageChanged = false;
    const newSrc = image.src && typeof image.src === 'object' ? { ...image.src } : {};
    const newAlt = image.alt && typeof image.alt === 'object' ? { ...image.alt } : {};
    
    // Check Src
    if (image.src && typeof image.src === 'object') {
       const defSrc = image.src[defLocale];
       if (defSrc) {
         for (const target of targetLocales) {
           if (!newSrc[target]) {
             newSrc[target] = defSrc;
             imageChanged = true;
           }
         }
       }
    }
    
    // Check Alt
    if (image.alt && typeof image.alt === 'object') {
       const defAlt = image.alt[defLocale];
       if (defAlt) {
         for (const target of targetLocales) {
           if (!newAlt[target]) {
             newAlt[target] = defAlt;
             imageChanged = true;
           }
         }
       }
    }
    
    if (imageChanged) {
      updates.image = { ...image, src: newSrc, alt: newAlt };
      hasUpdates = true;
    }
  }

  // 3. Options
  if (q.options && Array.isArray(q.options)) {
    let optionsChanged = false;
    const newOptions = q.options.map(opt => {
      const labelVal = opt.label;
      if (typeof labelVal === 'object' && labelVal !== null) {
        const map = { ...(labelVal as Record<string, string>) };
        const defValue = map[defLocale];
        
        if (defValue && defValue.trim() !== '') {
          let optChanged = false;
          for (const target of targetLocales) {
            if (!map[target] || map[target].trim() === '') {
              map[target] = defValue;
              optChanged = true;
            }
          }
          
          if (optChanged) {
            optionsChanged = true;
            return { ...opt, label: map };
          }
        }
      }
      return opt;
    });

    if (optionsChanged) {
      updates.options = newOptions;
      hasUpdates = true;
    }
  }

  if (hasUpdates) {
    graphStore.updateNode(selectedNodeId.value, updates as Partial<Question>);
  }
}

// ============================================================================
// Actions — shared helpers
// ============================================================================

const allActions = computed(() =>
  (selectedQuestion.value?.actions || [])
    .map((rule: any, index: number) => ({ rule, index }))
);

const expandedRuleIndex = ref<number | null>(null);

function moveRuleUp(index: number) {
  if (!selectedQuestion.value || !selectedNodeId.value || index <= 0) return;
  const actions = JSON.parse(JSON.stringify(selectedQuestion.value.actions || []));
  const tmp = actions[index - 1];
  actions[index - 1] = actions[index];
  actions[index] = tmp;
  if (expandedRuleIndex.value === index) expandedRuleIndex.value = index - 1;
  else if (expandedRuleIndex.value === index - 1) expandedRuleIndex.value = index;
  graphStore.updateNode(selectedNodeId.value, { actions });
}

function moveRuleDown(index: number) {
  if (!selectedQuestion.value || !selectedNodeId.value) return;
  const actions = JSON.parse(JSON.stringify(selectedQuestion.value.actions || []));
  if (index >= actions.length - 1) return;
  const tmp = actions[index + 1];
  actions[index + 1] = actions[index];
  actions[index] = tmp;
  if (expandedRuleIndex.value === index) expandedRuleIndex.value = index + 1;
  else if (expandedRuleIndex.value === index + 1) expandedRuleIndex.value = index;
  graphStore.updateNode(selectedNodeId.value, { actions });
}

function removeRoutingRule(globalIndex: number) {
  if (!selectedQuestion.value || !selectedNodeId.value) return;
  const actions = JSON.parse(JSON.stringify(selectedQuestion.value.actions || []));
  actions.splice(globalIndex, 1);
  graphStore.updateNode(selectedNodeId.value, { actions });
}

// ============================================================================
// Checkbox Actions
// ============================================================================

function addCheckboxRoutingRule() {
  if (!selectedQuestion.value || !selectedNodeId.value) return;
  
  const actions = [...(selectedQuestion.value.actions || [])];
  actions.push({
    when: { questionId: selectedQuestion.value.id, containsAny: [] },
  });

  graphStore.updateNode(selectedNodeId.value, { actions });
}

function hasConditionType(when: any, type: string): boolean {
  if (!when) return false;
  return type in when;
}

function isOptionInCondition(when: any, optionValue: string): boolean {
  if (!when) return false;
  const values = when.containsAny || when.containsAll || [];
  return values.includes(optionValue);
}

function toggleOptionInCondition(ruleIndex: number, optionValue: string, checked: boolean) {
  if (!selectedQuestion.value || !selectedNodeId.value) return;

  const actions = JSON.parse(JSON.stringify(selectedQuestion.value.actions || []));
  const rule = actions[ruleIndex];
  if (!rule) return;

  const condType = rule.when.containsAll ? 'containsAll' : 'containsAny';
  let values = rule.when[condType] || [];

  if (checked && !values.includes(optionValue)) {
    values = [...values, optionValue];
  } else if (!checked) {
    values = values.filter((v: string) => v !== optionValue);
  }
  
  rule.when = { questionId: selectedQuestion.value.id, [condType]: values };
  graphStore.updateNode(selectedNodeId.value, { actions });
}

function updateRoutingConditionType(ruleIndex: number, condType: string) {
  if (!selectedQuestion.value || !selectedNodeId.value) return;
  
  const actions = JSON.parse(JSON.stringify(selectedQuestion.value.actions || []));
  const rule = actions[ruleIndex];
  if (!rule) return;
  
  const currentValues = rule.when.containsAny || rule.when.containsAll || [];
  rule.when = { questionId: selectedQuestion.value.id, [condType]: currentValues };
  
  graphStore.updateNode(selectedNodeId.value, { actions });
}

/**
 * Toggle between routing mode (goto present) and effect-only mode (no goto).
 * When enabling routing, default target is 'submit'. Default is effect-only (no goto).
 */
async function toggleRuleRouting(globalIndex: number, enabled: boolean) {
  if (!selectedQuestion.value || !selectedNodeId.value) return;
  const actions = JSON.parse(JSON.stringify(selectedQuestion.value.actions || []));
  const rule = actions[globalIndex];
  if (!rule) return;
  if (enabled) {
    rule.goto = 'submit';
  } else {
    delete rule.goto;
    // Remove the connection from the associated output port
    const sourcePort = `routing_${globalIndex}`;
    const storeEdge = graphStore.edges.find(
      (e: any) => e.source === selectedNodeId.value && e.sourcePort === sourcePort
    );
    if (storeEdge) {
      graphStore.removeEdge(storeEdge.id);
      if (editorStore.reteEditor) {
        const reteConns = Array.from(editorStore.reteEditor.getConnections()) as any[];
        const reteConn = reteConns.find(
          (c: any) => c.source === selectedNodeId.value && c.sourceOutput === sourcePort
        );
        if (reteConn) {
          await editorStore.reteEditor.removeConnection(reteConn.id);
        }
      }
    }
  }
  graphStore.updateNode(selectedNodeId.value, { actions });
}

// ============================================================================
// Variable Actions
// ============================================================================

function addVariableRoutingRule() {
  if (!selectedQuestion.value || !selectedNodeId.value) return;
  const actions = JSON.parse(JSON.stringify(selectedQuestion.value.actions || []));
  actions.push({ when: { var: '', equals: 0 } });
  graphStore.updateNode(selectedNodeId.value, { actions });
}

function getVariableRuleOperator(when: any): string {
  if (when.gt !== undefined) return 'gt';
  if (when.gte !== undefined) return 'gte';
  if (when.lt !== undefined) return 'lt';
  if (when.lte !== undefined) return 'lte';
  return 'equals';
}

function getVariableRuleValue(when: any): number {
  return when.equals ?? when.gt ?? when.gte ?? when.lt ?? when.lte ?? 0;
}

// ============================================================================
// Multi-condition support (allOf / anyOf)
// ============================================================================

function getVarConditionLeaves(when: any): any[] {
  if (when?.allOf) return when.allOf;
  if (when?.anyOf) return when.anyOf;
  return [when];
}

function getVarCombinator(when: any): 'allOf' | 'anyOf' {
  return when?.anyOf ? 'anyOf' : 'allOf';
}

function packLeaves(leaves: any[], combinator: 'allOf' | 'anyOf'): any {
  return leaves.length === 1 ? leaves[0] : { [combinator]: leaves };
}

function addVarConditionLeaf(globalIndex: number) {
  if (!selectedQuestion.value || !selectedNodeId.value) return;
  const actions = JSON.parse(JSON.stringify(selectedQuestion.value.actions || []));
  const rule = actions[globalIndex];
  if (!rule) return;
  const leaves = getVarConditionLeaves(rule.when);
  const combinator = getVarCombinator(rule.when);
  rule.when = { [combinator]: [...leaves, { var: '', equals: 0 }] };
  graphStore.updateNode(selectedNodeId.value, { actions });
}

function removeVarConditionLeaf(globalIndex: number, leafIndex: number) {
  if (!selectedQuestion.value || !selectedNodeId.value) return;
  const actions = JSON.parse(JSON.stringify(selectedQuestion.value.actions || []));
  const rule = actions[globalIndex];
  if (!rule) return;
  const leaves = getVarConditionLeaves(rule.when);
  const combinator = getVarCombinator(rule.when);
  const newLeaves = leaves.filter((_: any, i: number) => i !== leafIndex);
  rule.when = packLeaves(newLeaves, combinator);
  graphStore.updateNode(selectedNodeId.value, { actions });
}

function updateVarLeafVar(globalIndex: number, leafIndex: number, varName: string) {
  if (!selectedQuestion.value || !selectedNodeId.value) return;
  const actions = JSON.parse(JSON.stringify(selectedQuestion.value.actions || []));
  const rule = actions[globalIndex];
  if (!rule) return;
  const leaves = getVarConditionLeaves(rule.when);
  const combinator = getVarCombinator(rule.when);
  leaves[leafIndex] = { ...leaves[leafIndex], var: varName };
  rule.when = packLeaves(leaves, combinator);
  graphStore.updateNode(selectedNodeId.value, { actions });
}

function updateVarLeafOperator(globalIndex: number, leafIndex: number, op: string) {
  if (!selectedQuestion.value || !selectedNodeId.value) return;
  const actions = JSON.parse(JSON.stringify(selectedQuestion.value.actions || []));
  const rule = actions[globalIndex];
  if (!rule) return;
  const leaves = getVarConditionLeaves(rule.when);
  const combinator = getVarCombinator(rule.when);
  leaves[leafIndex] = { var: leaves[leafIndex].var, [op]: getVariableRuleValue(leaves[leafIndex]) };
  rule.when = packLeaves(leaves, combinator);
  graphStore.updateNode(selectedNodeId.value, { actions });
}

function updateVarLeafValue(globalIndex: number, leafIndex: number, value: number) {
  if (!selectedQuestion.value || !selectedNodeId.value) return;
  const actions = JSON.parse(JSON.stringify(selectedQuestion.value.actions || []));
  const rule = actions[globalIndex];
  if (!rule) return;
  const leaves = getVarConditionLeaves(rule.when);
  const combinator = getVarCombinator(rule.when);
  leaves[leafIndex] = { var: leaves[leafIndex].var, [getVariableRuleOperator(leaves[leafIndex])]: value };
  rule.when = packLeaves(leaves, combinator);
  graphStore.updateNode(selectedNodeId.value, { actions });
}

function updateVarCombinator(globalIndex: number, combinator: 'allOf' | 'anyOf') {
  if (!selectedQuestion.value || !selectedNodeId.value) return;
  const actions = JSON.parse(JSON.stringify(selectedQuestion.value.actions || []));
  const rule = actions[globalIndex];
  if (!rule) return;
  const leaves = getVarConditionLeaves(rule.when);
  rule.when = { [combinator]: leaves };
  graphStore.updateNode(selectedNodeId.value, { actions });
}

// ============================================================================
// Per-action effects
// ============================================================================

function addRuleEffect(ruleIndex: number) {
  if (!selectedQuestion.value || !selectedNodeId.value) return;
  const actions = JSON.parse(JSON.stringify(selectedQuestion.value.actions || []));
  const rule = actions[ruleIndex];
  if (!rule) return;
  if (!rule.effects) rule.effects = [];
  rule.effects.push({ var: '', op: 'add', value: 0 });
  graphStore.updateNode(selectedNodeId.value, { actions });
}

function removeRuleEffect(ruleIndex: number | string, effectIndex: number | string) {
  if (!selectedQuestion.value || !selectedNodeId.value) return;
  const actions = JSON.parse(JSON.stringify(selectedQuestion.value.actions || []));
  const rule = actions[Number(ruleIndex)];
  if (!rule?.effects) return;
  rule.effects.splice(Number(effectIndex), 1);
  if (rule.effects.length === 0) delete rule.effects;
  graphStore.updateNode(selectedNodeId.value, { actions });
}

function updateRuleEffect(ruleIndex: number | string, effectIndex: number | string, field: string, value: any) {
  if (!selectedQuestion.value || !selectedNodeId.value) return;
  const actions = JSON.parse(JSON.stringify(selectedQuestion.value.actions || []));
  const rule = actions[Number(ruleIndex)];
  if (!rule?.effects?.[Number(effectIndex)]) return;
  if (value === undefined) {
    delete rule.effects[effectIndex][field];
  } else {
    rule.effects[effectIndex] = { ...rule.effects[effectIndex], [field]: value };
  }
  graphStore.updateNode(selectedNodeId.value, { actions });
}

// Effect management functions
function addEffect() {
  if (!selectedQuestion.value || !selectedNodeId.value) return;
  
  const effects = [...(selectedQuestion.value.effects || [])];
  effects.push({ var: '', op: 'add', value: 1 });
  graphStore.updateNode(selectedNodeId.value, { effects });
}

function updateEffect(index: number, field: string, value: unknown) {
  if (!selectedQuestion.value || !selectedNodeId.value) return;

  const effects = JSON.parse(JSON.stringify(selectedQuestion.value.effects || []));
  if (effects[index]) {
    if (value === undefined) {
      delete effects[index][field];
    } else {
      effects[index][field] = value;
    }
    graphStore.updateNode(selectedNodeId.value, { effects });
  }
}

function removeEffect(index: number) {
  if (!selectedQuestion.value || !selectedNodeId.value) return;
  
  const effects = [...(selectedQuestion.value.effects || [])];
  effects.splice(index, 1);
  graphStore.updateNode(selectedNodeId.value, { effects });
}

// Option-level effect management
function addOptionEffect(optionId: string) {
  if (!selectedQuestion.value || !selectedNodeId.value) return;
  const options = JSON.parse(JSON.stringify(selectedQuestion.value.options || []));
  const opt = options.find((o: Option) => o.id === optionId);
  if (!opt) return;
  opt.effects = [...(opt.effects || []), { var: '', op: 'add', value: 1 }];
  graphStore.updateNode(selectedNodeId.value, { options });
}

function updateOptionEffect(optionId: string, index: number, field: string, value: unknown) {
  if (!selectedQuestion.value || !selectedNodeId.value) return;
  const options = JSON.parse(JSON.stringify(selectedQuestion.value.options || []));
  const opt = options.find((o: Option) => o.id === optionId);
  if (!opt || !opt.effects?.[index]) return;
  if (value === undefined) {
    delete opt.effects[index][field];
  } else {
    opt.effects[index][field] = value;
  }
  graphStore.updateNode(selectedNodeId.value, { options });
}

function removeOptionEffect(optionId: string, index: number) {
  if (!selectedQuestion.value || !selectedNodeId.value) return;
  const options = JSON.parse(JSON.stringify(selectedQuestion.value.options || []));
  const opt = options.find((o: Option) => o.id === optionId);
  if (!opt) return;
  opt.effects = (opt.effects || []).filter((_: any, i: number) => i !== index);
  if (opt.effects.length === 0) delete opt.effects;
  graphStore.updateNode(selectedNodeId.value, { options });
}

// ============================================================================
// Effect mode helpers
// ============================================================================

/** Returns the current mode of an effect: 'literal' | 'variable' | 'function' */
function effectMode(effect: { value: number | string; lhs?: string }): 'literal' | 'variable' | 'function' {
  if (effect.lhs !== undefined) return 'function'
  if (typeof effect.value === 'string' && effect.value.startsWith('$')) return 'variable'
  return 'literal'
}

/** Cycles: literal → variable → function → literal */
function cycleEffectMode(current: 'literal' | 'variable' | 'function'): { value: number | string; lhs?: string } {
  if (current === 'literal') return { value: '$', lhs: undefined }
  if (current === 'variable') return { value: '$', lhs: '' }
  return { value: 0, lhs: undefined }  // function → literal
}

</script>

<template>
  <div class="inspector">
    <div class="inspector-header">
      <h3>{{ t('inspector.title') }}</h3>
    </div>

    <div v-if="!selectedNode" class="inspector-empty">
      <p>{{ t('inspector.emptyState') }}</p>
      <p class="hint">{{ t('inspector.rightClickHint') }}</p>
    </div>

    <div v-else-if="selectedNode.type === 'start'" class="inspector-content">
      <div class="property-group">
        <h4>{{ t('inspector.startNode') }}</h4>
        <p class="help-text">{{ t('inspector.startNodeHelp') }}</p>
      </div>
    </div>

    <div v-else-if="selectedNode.type === 'end'" class="inspector-content">
      <div class="property-group">
        <h4>{{ t('inspector.submitNode') }}</h4>
        <p class="help-text">{{ t('inspector.submitNodeHelp') }}</p>
      </div>
    </div>

    <div v-else-if="selectedQuestion && questionType" ref="inspectorContentRef" class="inspector-content">
      <!-- Missing Translations Warning -->
      <div v-if="hasMissingTranslations" class="translation-warning">
        <div class="warning-content">
          <span class="warning-icon">⚠️</span>
          <span>{{ t('inspector.missingTranslation', { locales: missingTranslationLocales.join(', ') }) }}</span>
        </div>
        <button class="btn-copy-all-fields" @click="fillMissingTranslations">
          <Globe :size="14" /> {{ t('inspector.fillMissingTranslations') }}
        </button>
      </div>
      
      <!-- Question Header -->
      <div class="inspector-node-header">
        <span class="node-type-icon"><component :is="getTypeIcon(questionType)" :size="20" /></span>
        <select 
          class="type-select"
          :value="questionType"
          @change="changeQuestionType(($event.target as HTMLSelectElement).value as QuestionType)"
        >
          <option value="textzeile">{{ t('qtype.textzeile') }}</option>
          <option value="textbox">{{ t('qtype.textbox') }}</option>
          <option value="select">{{ t('qtype.select') }}</option>
          <option value="checkbox">{{ t('qtype.checkbox') }}</option>
          <option value="int">{{ t('qtype.int') }}</option>
          <option value="date">{{ t('qtype.date') }}</option>
          <option value="info">{{ t('qtype.info') }}</option>
        </select>
      </div>
      <div class="node-id">
        <label>{{ t('inspector.id') }}</label>
        <code>{{ selectedQuestion.id }}</code>
      </div>

      <!-- Basic Properties -->
      <div class="property-group" data-section="basic">
        <h4>{{ t('inspector.basic') }}</h4>
        
        <div class="field">
          <label>{{ t('inspector.label') }}</label>
          <input
            type="text"
            :key="currentLocale"
            :value="getLabel(selectedQuestion)"
            @input="updateField('label', ($event.target as HTMLInputElement).value)"
            :placeholder="t('inspector.labelPlaceholder')"
          />
        </div>

        <div v-if="questionType === 'textzeile' || questionType === 'textbox'" class="field">
          <label>{{ t('inspector.placeholder') }}</label>
          <input
            type="text"
            :value="getResolvedValue(selectedQuestion.placeholder)"
            @input="updateField('placeholder', ($event.target as HTMLInputElement).value)"
            :placeholder="t('inspector.placeholderText')"
          />
        </div>

        <div class="field">
          <label>{{ t('inspector.description') }}</label>
          <textarea
            :key="currentLocale"
            :value="getResolvedValue(selectedQuestion.description)"
            @input="updateField('description', ($event.target as HTMLTextAreaElement).value)"
            :placeholder="t('inspector.descriptionPlaceholder')"
            rows="2"
          />
        </div>

        <div v-if="questionType !== 'info'" class="field checkbox-field">
          <input 
            type="checkbox" 
            :checked="selectedQuestion.required"
            @change="updateField('required', ($event.target as HTMLInputElement).checked)"
          />
          <span>{{ t('inspector.required') }}</span>
        </div>
      </div>



      <!-- Image Upload -->
      <div class="property-group" data-section="image">
        <div class="group-header">
          <h4>{{ t('inspector.image') }}</h4>
        </div>
        
        <!-- Smart Image Controls -->
        <div class="image-smart-controls">
          
          <!-- Case 1: Current Locale Missing Image -->
          <div v-if="missingImageLocales.includes(currentLocale)" class="image-warning-inline">
            <div class="warning-header">
               <span class="warning-icon-small">⚠️</span>
               <span>{{ t('inspector.missingImage', { locale: currentLocale }) }}</span>
            </div>
            
            <div class="image-adopt-actions" v-if="imageSourceLocales.length > 0">
               <!-- Multiple Sources: Dropdown -->
               <div v-if="imageSourceLocales.length > 1" class="adopt-group">
                  <span class="label-small">{{ t('inspector.adoptFrom') }}</span>
                  <select v-model="selectedImageSource" class="source-select">
                    <option v-for="loc in imageSourceLocales" :key="loc" :value="loc">{{ loc }}</option>
                  </select>
                  <button class="btn-adopt" @click="linkImageFrom(selectedImageSource)">
                    {{ t('inspector.adopt') }}
                  </button>
               </div>
               
               <!-- Single Source: Direct Button -->
               <div v-else class="adopt-group">
                  <button class="btn-adopt" @click="linkImageFrom(imageSourceLocales[0]!)">
                    {{ t('inspector.adoptFromLocale', { locale: imageSourceLocales[0] ?? '' }) }}
                  </button>
               </div>
            </div>
          </div>

          <!-- Case 2: Current Locale Has Image -> Offer to Distribute (Only if others are missing) -->

        </div>
        
        <div v-if="selectedQuestion.image && getImageSrc(selectedQuestion.image)" class="image-preview">
          <img 
            :key="`img-${currentLocale}-${selectedNodeId}`"
            :src="getImageSrc(selectedQuestion.image)" 
            alt="Preview" 
            @error="handleImageError"
          />
          <button class="btn-remove-image" @click="removeImage"><X :size="14" /></button>
        </div>
        <div v-else-if="selectedQuestion.image" class="image-missing">
          <!-- Text removed as it is covered by smart controls, but div kept for layout spacing if needed or removed -->
        </div>
        
        <div class="field">
          <label class="file-upload-btn">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              @change="handleImageUpload($event)"
              hidden
            />
            <Plus :size="14" /> {{ selectedQuestion.image ? t('inspector.changeImage') : t('inspector.uploadImage') }}
          </label>
        </div>
        
        <div v-if="selectedQuestion.image" class="image-config">
          <div class="field">
            <label>Alt Text ({{ currentLocale }})</label>
            <input 
              type="text"
              :value="getImageAlt(selectedQuestion.image)"
              @input="updateImageAlt(($event.target as HTMLInputElement).value)"
              :placeholder="t('inspector.imageAlt')"
            />
          </div>
          
          <div class="field-row">
            <div class="field">
              <label>{{ t('inspector.imagePlacement') }}</label>
              <select 
                :value="getImagePlacement(selectedQuestion.image)"
                @change="updateImageField('placement', ($event.target as HTMLSelectElement).value)"
              >
                <option value="before">{{ t('inspector.beforeQuestion') }}</option>
                <option value="after">{{ t('inspector.afterQuestion') }}</option>
              </select>
            </div>
            <div class="field">
              <label>{{ t('inspector.maxHeight') }}</label>
              <input 
                type="number"
                :value="getImageMaxHeight(selectedQuestion.image)"
                @input="updateImageField('maxHeight', parseInt(($event.target as HTMLInputElement).value) || undefined)"
                placeholder="auto"
              />
            </div>
          </div>
          
          <div class="field">
            <label>{{ t('inspector.imageFitMode') }}</label>
            <select 
              :value="getImageFit(selectedQuestion.image)"
              @change="updateImageField('fit', ($event.target as HTMLSelectElement).value)"
            >
              <option value="cover">{{ t('inspector.cover') }}</option>
              <option value="contain">{{ t('inspector.contain') }}</option>
              <option value="fill">{{ t('inspector.fill') }}</option>
            </select>
          </div>
          
          <div v-if="graphStore.supportedLocales.length > 1 && selectedQuestion.image && getImageSrc(selectedQuestion.image) && missingImageLocales.length > 0" class="field">
            <button class="btn-copy-all" @click="copyImageToAllLocales">
              <Globe :size="14" /> {{ t('inspector.copyImageToLocales') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Text Validation -->
      <div v-if="questionType === 'textzeile' || questionType === 'textbox'" class="property-group" data-section="validation">
        <h4>{{ t('inspector.validation') }}</h4>

        <div class="field-row">
          <div class="field">
            <label>{{ t('inspector.minLength') }}</label>
            <input 
              type="number" 
              :value="selectedQuestion.validation?.minLength"
              @input="updateNestedField(['validation', 'minLength'], parseInt(($event.target as HTMLInputElement).value) || undefined)"
              min="0"
            />
          </div>
          <div class="field">
            <label>{{ t('inspector.maxLength') }}</label>
            <input 
              type="number" 
              :value="selectedQuestion.validation?.maxLength"
              @input="updateNestedField(['validation', 'maxLength'], parseInt(($event.target as HTMLInputElement).value) || undefined)"
              min="0"
            />
          </div>
        </div>
        
        <div class="field">
          <label>{{ t('inspector.pattern') }}</label>
          <input 
            type="text" 
            :value="selectedQuestion.validation?.pattern"
            @input="updateNestedField(['validation', 'pattern'], ($event.target as HTMLInputElement).value || undefined)"
            placeholder="e.g. ^[A-Za-z]+$"
          />
        </div>
      </div>

      <!-- Number Validation -->
      <div v-if="questionType === 'int'" class="property-group" data-section="validation">
        <h4>{{ t('inspector.validation') }}</h4>

        <div class="field-row">
          <div class="field">
            <label>{{ t('inspector.minValue') }}</label>
            <input
              type="number"
              :value="selectedQuestion.validation?.min"
              @input="{ const v = parseInt(($event.target as HTMLInputElement).value); updateNestedField(['validation', 'min'], isNaN(v) ? undefined : Math.max(0, v)) }"
              min="0"
            />
          </div>
          <div class="field">
            <label>{{ t('inspector.maxValue') }}</label>
            <input
              type="number"
              :value="selectedQuestion.validation?.max"
              @input="{ const v = parseInt(($event.target as HTMLInputElement).value); updateNestedField(['validation', 'max'], isNaN(v) ? undefined : Math.max(0, v)) }"
              min="0"
            />
          </div>
        </div>
      </div>

      <!-- Date Validation -->
      <div v-if="questionType === 'date'" class="property-group" data-section="validation">
        <h4>{{ t('inspector.validation') }}</h4>

        <div class="field-row">
          <div class="field">
            <label>{{ t('inspector.minDate') }}</label>
            <input 
              type="text" 
              :value="selectedQuestion.validation?.min"
              @input="updateNestedField(['validation', 'min'], ($event.target as HTMLInputElement).value || undefined)"
              :placeholder="t('inspector.datePlaceholder')"
            />
          </div>
          <div class="field">
            <label>{{ t('inspector.maxDate') }}</label>
            <input 
              type="text" 
              :value="selectedQuestion.validation?.max"
              @input="updateNestedField(['validation', 'max'], ($event.target as HTMLInputElement).value || undefined)"
              :placeholder="t('inspector.datePlaceholder')"
            />
          </div>
        </div>
      </div>

      <!-- Checkbox Validation -->
      <div v-if="questionType === 'checkbox'" class="property-group" data-section="validation">
        <h4>{{ t('inspector.validation') }}</h4>

        <div class="field">
          <label>{{ t('inspector.maxSelections') }}</label>
          <input 
            type="number" 
            :value="selectedQuestion.validation?.maxSelections"
            @input="updateNestedField(['validation', 'maxSelections'], parseInt(($event.target as HTMLInputElement).value) || undefined)"
            min="1"
          />
        </div>
      </div>

      <!-- Options Editor (select/checkbox) -->
      <div v-if="questionType === 'select' || questionType === 'checkbox'" class="property-group" data-section="options">
        <div class="group-header">
          <h4>{{ t('inspector.options') }}</h4>
          <button class="btn-sm" @click="addOption"><Plus :size="14" /> {{ t('inspector.addOption') }}</button>
        </div>
        
        <div class="options-list">
          <div 
            v-for="(opt, index) in selectedQuestion.options" 
            :key="opt.id" 
            class="option-item"
            :class="{ editing: editingOptionId === opt.id }"
          >
            <div class="option-header" @click="editingOptionId = editingOptionId === opt.id ? null : opt.id">
              <span class="option-label">{{ getResolvedValue(opt.label) || t('inspector.noOptionLabel') }}</span>
              <span class="option-badges">
                <span class="rule-type-badge badge-route" v-if="opt.next" :title="t('inspector.optionHasRoute')">→</span>
                <span class="rule-type-badge badge-fx" v-if="opt.effects?.length" :title="t('inspector.optionHasFx')">FX</span>
              </span>
              <div class="option-actions">
                <button 
                  v-if="index > 0" 
                  class="btn-icon-sm" 
                  @click.stop="moveOptionUp(index)"
                  :title="t('inspector.moveUp')"
                >↑</button>
                <button 
                  v-if="index < (selectedQuestion.options?.length || 0) - 1" 
                  class="btn-icon-sm" 
                  @click.stop="moveOptionDown(index)"
                  :title="t('inspector.moveDown')"
                >↓</button>
                <button 
                  class="btn-icon-sm danger" 
                  @click.stop="deleteOption(opt.id)"
                  :title="t('inspector.delete')"
                ><Trash2 :size="14" /></button>
              </div>
            </div>
            
            <div v-if="editingOptionId === opt.id" class="option-details">
              <div class="field">
                <label>{{ t('inspector.optionLabel') }}</label>
                <input
                  type="text"
                  :value="getResolvedValue(opt.label)"
                  @input="updateOption(opt.id, 'label', ($event.target as HTMLInputElement).value)"
                  :placeholder="t('inspector.optionLabelPlaceholder')"
                />
              </div>
              <div class="field">
                <label>{{ t('inspector.optionValue') }}</label>
                <input
                  type="text"
                  :value="opt.value"
                  :class="{ 'input-error': duplicateOptionValues.has(opt.value) }"
                  @input="updateOption(opt.id, 'value', ($event.target as HTMLInputElement).value)"
                  :placeholder="t('inspector.optionValuePlaceholder')"
                />
                <span v-if="duplicateOptionValues.has(opt.value)" class="field-error">{{ t('inspector.duplicateValue') }}</span>
              </div>
              <div class="field checkbox-field">
                <input 
                  type="checkbox"
                  :checked="!!opt.next"
                  @change="toggleOptionNext(opt.id)"
                />
                <span>{{ t('inspector.routingEnabled') }}</span>
              </div>
              <div v-if="opt.next" class="field">
                <span class="help-text">{{ t('inspector.connectViaSocket') }}</span>
              </div>

              <!-- Per-Option Variable Effects -->
              <div class="option-effects">
                <div class="option-effects-header">
                  <span class="option-effects-label">{{ t('inspector.variableEffects') }}</span>
                  <button class="btn-sm" @click.stop="addOptionEffect(opt.id)"><Plus :size="12" /> {{ t('inspector.addOption') }}</button>
                </div>
                <div class="effects-list">
                  <div
                    v-for="(effect, ei) in (opt.effects || [])"
                    :key="ei"
                    class="effect-item"
                    :class="{ 'effect-literal': effectMode(effect) === 'literal', 'effect-fn': effectMode(effect) === 'function' }"
                  >
                    <!-- Function mode -->
                    <template v-if="effectMode(effect) === 'function'">
                      <select
                        class="effect-var"
                        :value="effect.var"
                        @change="updateOptionEffect(opt.id, ei, 'var', ($event.target as HTMLSelectElement).value)"
                      >
                        <option value="">{{ t('inspector.targetVar') }}</option>
                        <option v-for="v in graphStore.variables" :key="v.id" :value="v.id">{{ v.id }}</option>
                      </select>
                      <span class="effect-equals">=</span>
                      <select
                        class="effect-var"
                        :value="effect.lhs"
                        @change="updateOptionEffect(opt.id, ei, 'lhs', ($event.target as HTMLSelectElement).value)"
                      >
                        <option value="">{{ t('inspector.leftVar') }}</option>
                        <option v-for="v in graphStore.variables" :key="v.id" :value="v.id">{{ v.id }}</option>
                      </select>
                      <select
                        class="effect-op"
                        :value="effect.op || 'add'"
                        @change="updateOptionEffect(opt.id, ei, 'op', ($event.target as HTMLSelectElement).value)"
                      >
                        <option value="add">+</option>
                        <option value="sub">-</option>
                        <option value="mul">×</option>
                        <option value="div">÷</option>
                      </select>
                      <select
                        class="effect-value effect-value-var"
                        :value="typeof effect.value === 'string' && effect.value.startsWith('$') ? (effect.value as string).slice(1) : ''"
                        @change="updateOptionEffect(opt.id, ei, 'value', '$' + ($event.target as HTMLSelectElement).value)"
                      >
                        <option value="">{{ t('inspector.rightVar') }}</option>
                        <option v-for="v in graphStore.variables" :key="v.id" :value="v.id">{{ v.id }}</option>
                      </select>
                      <button
                        class="btn-icon-sm"
                        :title="t('inspector.functionMode')"
                        @click.stop="(() => { const m = cycleEffectMode('function'); updateOptionEffect(opt.id, ei, 'value', m.value); updateOptionEffect(opt.id, ei, 'lhs', m.lhs); })()"
                      >ƒ</button>
                    </template>
                    <!-- Literal / Variable mode -->
                    <template v-else>
                      <select
                        class="effect-var"
                        :value="effect.var"
                        @change="updateOptionEffect(opt.id, ei, 'var', ($event.target as HTMLSelectElement).value)"
                      >
                        <option value="">{{ t('inspector.selectVariable') }}</option>
                        <option v-for="v in graphStore.variables" :key="v.id" :value="v.id">{{ v.id }}</option>
                      </select>
                      <select
                        class="effect-op"
                        :value="effect.op || 'add'"
                        @change="updateOptionEffect(opt.id, ei, 'op', ($event.target as HTMLSelectElement).value)"
                      >
                        <option value="add">+</option>
                        <option value="sub">-</option>
                        <option value="mul">×</option>
                        <option value="div">÷</option>
                        <option value="set">=</option>
                      </select>
                      <select
                        v-if="effectMode(effect) === 'variable'"
                        class="effect-value effect-value-var"
                        :value="(effect.value as string).slice(1)"
                        @change="updateOptionEffect(opt.id, ei, 'value', '$' + ($event.target as HTMLSelectElement).value)"
                      >
                        <option value="">{{ t('inspector.selectVariable') }}</option>
                        <option v-for="v in graphStore.variables" :key="v.id" :value="v.id">{{ v.id }}</option>
                      </select>
                      <input
                        v-else
                        type="number"
                        class="effect-value"
                        :value="effect.value"
                        @input="updateOptionEffect(opt.id, ei, 'value', parseFloat(($event.target as HTMLInputElement).value) || 0)"
                        placeholder="Value"
                      />
                      <button
                        class="btn-icon-sm"
                        :title="effectMode(effect) === 'variable' ? t('inspector.variableMode') : t('inspector.literalMode')"
                        @click.stop="(() => { const m = cycleEffectMode(effectMode(effect)); updateOptionEffect(opt.id, ei, 'value', m.value); updateOptionEffect(opt.id, ei, 'lhs', m.lhs); if (m.lhs !== undefined && effect.op === 'set') updateOptionEffect(opt.id, ei, 'op', 'add'); })()"
                      >{{ effectMode(effect) === 'variable' ? '$' : '#' }}</button>
                    </template>
                    <button class="btn-icon-sm danger" @click.stop="removeOptionEffect(opt.id, ei)"><X :size="14" /></button>
                  </div>
                  <div v-if="!opt.effects?.length" class="empty-effects">
                    {{ t('inspector.noOptionEffects') }}
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div v-if="!selectedQuestion.options?.length" class="empty-options">
            {{ t('inspector.noOptions') }}
          </div>
        </div>
      </div>

      <!-- Actions (unified, ordered by priority) -->
      <div v-if="selectedQuestion" class="property-group" data-section="actions">
        <div class="group-header">
          <h4>{{ t('inspector.actions') }}</h4>
          <div class="group-header-actions">
            <button v-if="questionType === 'checkbox'" class="btn-sm" @click="addCheckboxRoutingRule"><Plus :size="14" /> {{ t('inspector.addCheckboxRule') }}</button>
            <button class="btn-sm" :disabled="!graphStore.variables.length" @click="addVariableRoutingRule"><Plus :size="14" /> {{ t('inspector.addVariableRule') }}</button>
          </div>
        </div>
        <p class="help-text">{{ t('inspector.rulesTopToBottom') }}</p>

        <div class="routing-rules-list">
          <div
            v-for="{ rule, index: globalIndex } in allActions"
            :key="globalIndex"
            class="routing-rule-item"
            :class="{ editing: expandedRuleIndex === globalIndex }"
          >
            <div class="rule-header" @click="expandedRuleIndex = expandedRuleIndex === globalIndex ? null : globalIndex">
              <span class="rule-label">
                <span class="rule-type-badge" :class="(rule.when?.containsAny !== undefined || rule.when?.containsAll !== undefined) ? 'badge-checkbox' : 'badge-var'">
                  {{ (rule.when?.containsAny !== undefined || rule.when?.containsAll !== undefined) ? 'CB' : 'Var' }}
                </span>
                <span class="rule-type-badge badge-fx" v-if="rule.goto === undefined" :title="t('inspector.effectOnlyTitle')">FX</span>
                <span class="rule-number">{{ t('inspector.priority', { n: globalIndex + 1 }) }}</span>
              </span>
              <div class="option-actions">
                <button
                  v-if="globalIndex > 0"
                  class="btn-icon-sm"
                  @click.stop="moveRuleUp(globalIndex)"
                  :title="t('inspector.moveUp')"
                >↑</button>
                <button
                  v-if="globalIndex < allActions.length - 1"
                  class="btn-icon-sm"
                  @click.stop="moveRuleDown(globalIndex)"
                  :title="t('inspector.moveDown')"
                >↓</button>
                <button
                  class="btn-icon-sm danger"
                  @click.stop="removeRoutingRule(globalIndex)"
                  :title="t('inspector.delete')"
                ><Trash2 :size="14" /></button>
              </div>
            </div>

            <div v-if="expandedRuleIndex === globalIndex" class="rule-details">
              <!-- Checkbox rule body -->
              <template v-if="rule.when?.containsAny !== undefined || rule.when?.containsAll !== undefined">
                <div class="rule-condition">
                  <label>{{ t('inspector.condition') }}</label>
                  <select @change="updateRoutingConditionType(globalIndex, ($event.target as HTMLSelectElement).value)">
                    <option value="containsAny" :selected="hasConditionType(rule.when, 'containsAny')">{{ t('inspector.anyOfSelected') }}</option>
                    <option value="containsAll" :selected="hasConditionType(rule.when, 'containsAll')">{{ t('inspector.allOfSelected') }}</option>
                  </select>
                </div>
                <div class="rule-options">
                  <label>{{ t('inspector.conditionOptions') }}</label>
                  <div class="option-checkboxes">
                    <div v-for="opt in (selectedQuestion.options || [])" :key="opt.id" class="option-checkbox">
                      <input
                        type="checkbox"
                        :checked="isOptionInCondition(rule.when, opt.value)"
                        @change="toggleOptionInCondition(globalIndex, opt.value, ($event.target as HTMLInputElement).checked)"
                      />
                      <span>{{ getResolvedValue(opt.label) || opt.value }}</span>
                    </div>
                  </div>
                </div>
              </template>

              <!-- Variable rule body -->
              <template v-else>
                <div
                  v-for="(leaf, leafIndex) in getVarConditionLeaves(rule.when)"
                  :key="leafIndex"
                  class="rule-condition var-rule-condition"
                >
                  <!-- AND/OR combinator — shown on every row after the first -->
                  <select
                    v-if="leafIndex > 0"
                    class="var-combinator-select"
                    :value="getVarCombinator(rule.when)"
                    @change="updateVarCombinator(globalIndex, ($event.target as HTMLSelectElement).value as 'allOf' | 'anyOf')"
                  >
                    <option value="allOf">AND</option>
                    <option value="anyOf">OR</option>
                  </select>
                  <select
                    :value="leaf.var || ''"
                    @change="updateVarLeafVar(globalIndex, leafIndex, ($event.target as HTMLSelectElement).value)"
                  >
                    <option value="">{{ t('inspector.selectVariable') }}</option>
                    <option v-for="v in graphStore.variables" :key="v.id" :value="v.id">{{ v.id }}</option>
                  </select>
                  <select
                    class="var-op-select"
                    :value="getVariableRuleOperator(leaf)"
                    @change="updateVarLeafOperator(globalIndex, leafIndex, ($event.target as HTMLSelectElement).value)"
                  >
                    <option value="equals">=</option>
                    <option value="gt">&gt;</option>
                    <option value="gte">&gt;=</option>
                    <option value="lt">&lt;</option>
                    <option value="lte">&lt;=</option>
                  </select>
                  <input
                    class="var-val-input"
                    type="number"
                    :value="getVariableRuleValue(leaf)"
                    @input="updateVarLeafValue(globalIndex, leafIndex, parseFloat(($event.target as HTMLInputElement).value) || 0)"
                  />
                  <!-- + on first row, trash on additional rows -->
                  <button
                    v-if="leafIndex === 0"
                    class="btn-icon-sm"
                    :disabled="!graphStore.variables.length"
                    @click.stop="addVarConditionLeaf(globalIndex)"
                    :title="t('inspector.addCondition')"
                  ><Plus :size="12" /></button>
                  <button
                    v-else
                    class="btn-icon-sm"
                    @click.stop="removeVarConditionLeaf(globalIndex, leafIndex)"
                    :title="t('inspector.removeCondition')"
                  ><Trash2 :size="12" /></button>
                </div>
              </template>

              <!-- Routing toggle -->
              <div class="rule-routing-toggle">
                <label class="toggle-label">
                  <span class="toggle-text">{{ t('inspector.routingForward') }}</span>
                  <span class="toggle-description">{{ rule.goto !== undefined ? t('inspector.routingNavigates') : t('inspector.effectOnlyDesc') }}</span>
                </label>
                <button
                  class="toggle-switch"
                  :class="{ active: rule.goto !== undefined }"
                  role="switch"
                  :aria-checked="rule.goto !== undefined"
                  @click.stop="toggleRuleRouting(globalIndex, rule.goto === undefined)"
                  :title="t('inspector.toggleRouting')"
                >
                  <span class="toggle-thumb" />
                </button>
              </div>

              <div v-if="rule.goto !== undefined" class="rule-target">
                <span class="help-text">{{ t('inspector.connectViaRule', { n: globalIndex + 1 }) }}</span>
              </div>

              <!-- Per-rule variable effects -->
              <div class="rule-effects">
                <div class="rule-effects-header">
                  <span class="rule-effects-label">{{ t('inspector.variableEffects') }}</span>
                  <button class="btn-sm" :disabled="!graphStore.variables.length" @click.stop="addRuleEffect(globalIndex)"><Plus :size="12" /> {{ t('inspector.addOption') }}</button>
                </div>
                <div v-if="!graphStore.variables.length" class="empty-effects" style="font-size:0.7rem">
                  {{ t('inspector.noVariablesDefined') }}
                </div>
                <div v-else class="effects-list">
                  <div v-for="(effect, ei) in (rule.effects || [])" :key="ei" class="effect-item" :class="{ 'effect-literal': effectMode(effect) === 'literal', 'effect-fn': effectMode(effect) === 'function' }">
                    <!-- Function mode -->
                    <template v-if="effectMode(effect) === 'function'">
                      <select class="effect-var" :value="effect.var"
                        @change="updateRuleEffect(globalIndex, ei, 'var', ($event.target as HTMLSelectElement).value)">
                        <option value="">{{ t('inspector.targetVar') }}</option>
                        <option v-for="v in graphStore.variables" :key="v.id" :value="v.id">{{ v.id }}</option>
                      </select>
                      <span class="effect-equals">=</span>
                      <select class="effect-var" :value="effect.lhs"
                        @change="updateRuleEffect(globalIndex, ei, 'lhs', ($event.target as HTMLSelectElement).value)">
                        <option value="">{{ t('inspector.leftVar') }}</option>
                        <option v-for="v in graphStore.variables" :key="v.id" :value="v.id">{{ v.id }}</option>
                      </select>
                      <select class="effect-op" :value="effect.op || 'add'"
                        @change="updateRuleEffect(globalIndex, ei, 'op', ($event.target as HTMLSelectElement).value)">
                        <option value="add">+</option>
                        <option value="sub">-</option>
                        <option value="mul">×</option>
                        <option value="div">÷</option>
                      </select>
                      <select
                        class="effect-value effect-value-var"
                        :value="typeof effect.value === 'string' && effect.value.startsWith('$') ? (effect.value as string).slice(1) : ''"
                        @change="updateRuleEffect(globalIndex, ei, 'value', '$' + ($event.target as HTMLSelectElement).value)"
                      >
                        <option value="">{{ t('inspector.rightVar') }}</option>
                        <option v-for="v in graphStore.variables" :key="v.id" :value="v.id">{{ v.id }}</option>
                      </select>
                      <button
                        class="btn-icon-sm"
                        :title="t('inspector.functionMode')"
                        @click.stop="(() => { const m = cycleEffectMode('function'); updateRuleEffect(globalIndex, ei, 'value', m.value); updateRuleEffect(globalIndex, ei, 'lhs', m.lhs); })()"
                      >ƒ</button>
                    </template>
                    <!-- Literal / Variable mode -->
                    <template v-else>
                      <select class="effect-var" :value="effect.var"
                        @change="updateRuleEffect(globalIndex, ei, 'var', ($event.target as HTMLSelectElement).value)">
                        <option value="">{{ t('inspector.selectVariable') }}</option>
                        <option v-for="v in graphStore.variables" :key="v.id" :value="v.id">{{ v.id }}</option>
                      </select>
                      <select class="effect-op" :value="effect.op || 'add'"
                        @change="updateRuleEffect(globalIndex, ei, 'op', ($event.target as HTMLSelectElement).value)">
                        <option value="add">+</option>
                        <option value="sub">-</option>
                        <option value="mul">×</option>
                        <option value="div">÷</option>
                        <option value="set">=</option>
                      </select>
                      <select
                        v-if="effectMode(effect) === 'variable'"
                        class="effect-value effect-value-var"
                        :value="(effect.value as string).slice(1)"
                        @change="updateRuleEffect(globalIndex, ei, 'value', '$' + ($event.target as HTMLSelectElement).value)"
                      >
                        <option value="">{{ t('inspector.selectVariable') }}</option>
                        <option v-for="v in graphStore.variables" :key="v.id" :value="v.id">{{ v.id }}</option>
                      </select>
                      <input
                        v-else
                        type="number"
                        class="effect-value"
                        :value="effect.value"
                        @input="updateRuleEffect(globalIndex, ei, 'value', parseFloat(($event.target as HTMLInputElement).value) || 0)"
                        placeholder="0"
                      />
                      <button
                        class="btn-icon-sm"
                        :title="effectMode(effect) === 'variable' ? t('inspector.variableMode') : t('inspector.literalMode')"
                        @click.stop="(() => { const m = cycleEffectMode(effectMode(effect)); updateRuleEffect(globalIndex, ei, 'value', m.value); updateRuleEffect(globalIndex, ei, 'lhs', m.lhs); if (m.lhs !== undefined && effect.op === 'set') updateRuleEffect(globalIndex, ei, 'op', 'add'); })()"
                      >{{ effectMode(effect) === 'variable' ? '$' : '#' }}</button>
                    </template>
                    <button class="btn-icon-sm danger" @click.stop="removeRuleEffect(globalIndex, ei)"><Trash2 :size="14" /></button>
                  </div>
                  <div v-if="!(rule.effects?.length)" class="empty-effects" style="font-size:0.7rem">
                    {{ t('inspector.noRuleEffects') }}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-if="!allActions.length" class="empty-rules">
            {{ t('inspector.noActions') }}
          </div>
        </div>
      </div>

      <!-- On Answer Effects (unconditional) -->
      <div class="property-group" data-section="effects">
        <div class="group-header">
          <h4>{{ t('inspector.onAnswer') }}</h4>
          <button class="btn-sm" @click="addEffect"><Plus :size="14" /> {{ t('inspector.addEffect') }}</button>
        </div>
        <p class="help-text">{{ t('inspector.onAnswerHelp') }}</p>
        
        <div class="effects-list">
          <div v-for="(effect, index) in (selectedQuestion.effects || [])" :key="index" class="effect-item" :class="{ 'effect-literal': effectMode(effect) === 'literal', 'effect-fn': effectMode(effect) === 'function' }">
            <!-- Function mode: var = lhs op rhs -->
            <template v-if="effectMode(effect) === 'function'">
              <select
                class="effect-var"
                :value="effect.var"
                @change="updateEffect(index, 'var', ($event.target as HTMLSelectElement).value)"
              >
                <option value="">{{ t('inspector.targetVar') }}</option>
                <option v-for="v in graphStore.variables" :key="v.id" :value="v.id">{{ v.id }}</option>
              </select>
              <span class="effect-equals">=</span>
              <select
                class="effect-var"
                :value="effect.lhs"
                @change="updateEffect(index, 'lhs', ($event.target as HTMLSelectElement).value)"
              >
                <option value="">{{ t('inspector.leftVar') }}</option>
                <option v-for="v in graphStore.variables" :key="v.id" :value="v.id">{{ v.id }}</option>
              </select>
              <select
                class="effect-op"
                :value="effect.op || 'add'"
                @change="updateEffect(index, 'op', ($event.target as HTMLSelectElement).value)"
              >
                <option value="add">+</option>
                <option value="sub">-</option>
                <option value="mul">×</option>
                <option value="div">÷</option>
              </select>
              <select
                class="effect-value effect-value-var"
                :value="typeof effect.value === 'string' && effect.value.startsWith('$') ? (effect.value as string).slice(1) : ''"
                @change="updateEffect(index, 'value', '$' + ($event.target as HTMLSelectElement).value)"
              >
                <option value="">{{ t('inspector.rightVar') }}</option>
                <option v-for="v in graphStore.variables" :key="v.id" :value="v.id">{{ v.id }}</option>
              </select>
              <button
                class="btn-icon-sm"
                :title="t('inspector.functionMode')"
                @click.stop="(() => { const m = cycleEffectMode('function'); updateEffect(index, 'value', m.value); updateEffect(index, 'lhs', m.lhs); })()"
              >ƒ</button>
            </template>
            <!-- Literal / Variable mode -->
            <template v-else>
              <select
                class="effect-var"
                :value="effect.var"
                @change="updateEffect(index, 'var', ($event.target as HTMLSelectElement).value)"
              >
                <option value="">{{ t('inspector.selectVariable') }}</option>
                <option v-for="v in graphStore.variables" :key="v.id" :value="v.id">{{ v.id }}</option>
              </select>
              <select
                class="effect-op"
                :value="effect.op || 'add'"
                @change="updateEffect(index, 'op', ($event.target as HTMLSelectElement).value)"
              >
                <option value="add">+</option>
                <option value="sub">-</option>
                <option value="mul">×</option>
                <option value="div">÷</option>
                <option value="set">=</option>
              </select>
              <select
                v-if="effectMode(effect) === 'variable'"
                class="effect-value effect-value-var"
                :value="(effect.value as string).slice(1)"
                @change="updateEffect(index, 'value', '$' + ($event.target as HTMLSelectElement).value)"
              >
                <option value="">{{ t('inspector.selectVariable') }}</option>
                <option v-for="v in graphStore.variables" :key="v.id" :value="v.id">{{ v.id }}</option>
              </select>
              <input
                v-else
                type="number"
                class="effect-value"
                :value="effect.value"
                @input="updateEffect(index, 'value', parseFloat(($event.target as HTMLInputElement).value) || 0)"
                placeholder="0"
              />
              <button
                class="btn-icon-sm"
                :title="effectMode(effect) === 'variable' ? t('inspector.variableMode') : t('inspector.literalMode')"
                @click.stop="(() => { const m = cycleEffectMode(effectMode(effect)); updateEffect(index, 'value', m.value); updateEffect(index, 'lhs', m.lhs); if (m.lhs !== undefined && effect.op === 'set') updateEffect(index, 'op', 'add'); })()"
              >{{ effectMode(effect) === 'variable' ? '$' : '#' }}</button>
            </template>
            <button class="btn-icon-sm danger" @click="removeEffect(index)"><Trash2 :size="14" /></button>
          </div>
          
          <div v-if="!selectedQuestion.effects?.length" class="empty-effects">
            {{ t('inspector.noEffects') }}
          </div>
        </div>
      </div>

      <!-- Delete Button -->
      <div class="property-group">
        <button class="danger full-width" @click="deleteSelectedNode">
          <Trash2 :size="16" /> {{ t('inspector.deleteQuestion') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.inspector {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.inspector-header {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--color-border);
}

.inspector-header h3 {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.inspector-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  text-align: center;
  gap: 0.5rem;
}

.inspector-empty p {
  color: var(--color-text-muted);
  font-size: 0.875rem;
}

.inspector-empty .hint {
  font-size: 0.75rem;
  opacity: 0.7;
}

.inspector-content {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
}

.inspector-node-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.node-type-icon {
  font-size: 1.25rem;
}

.node-type-label {
  font-weight: 600;
  color: var(--color-accent);
}

.type-select {
  flex: 1;
  font-weight: 500;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  padding: 0.35rem 0.5rem;
  font-size: 0.8rem;
  color: var(--color-text-primary);
  cursor: pointer;
}

.type-select:hover {
  background: var(--color-bg-tertiary);
}

.node-id {
  margin-bottom: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--color-border);
}

.node-id code {
  display: block;
  font-size: 0.625rem;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  word-break: break-all;
}

.property-group {
  margin-bottom: 1.5rem;
  border-radius: var(--radius-sm);
  transition: background 0.2s ease;
}

@keyframes section-flash {
  0%   { background: rgba(33, 173, 243, 0.18); }
  60%  { background: rgba(33, 173, 243, 0.10); }
  100% { background: transparent; }
}

:global(.section-highlight) {
  animation: section-flash 1.2s ease-out forwards;
}

.group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.group-header h4 {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
}

.property-group h4 {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
  margin-bottom: 0.75rem;
}

.field-error {
  font-size: 0.625rem;
  color: var(--color-error);
}

.input-error {
  border-color: var(--color-error) !important;
}

.help-text {
  font-size: 0.625rem;
  color: var(--color-text-muted);
  margin-top: 0.25rem;
}

.field {
  margin-bottom: 0.75rem;
}

.field input,
.field textarea,
.field select {
  width: 100%;
}

.field textarea {
  resize: vertical;
}

.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}

.checkbox-field {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.checkbox-field input[type="checkbox"] {
  width: auto;
}

.checkbox-field span {
  font-size: 0.875rem;
}

/* Options List */
.options-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.option-item {
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.option-item.editing {
  border: 1px solid var(--color-accent);
}

.option-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.option-header:hover {
  background: var(--color-border);
}

.option-label {
  font-size: 0.875rem;
  color: var(--color-text-primary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.option-badges {
  display: flex;
  gap: 0.25rem;
  align-items: center;
  flex-shrink: 0;
  margin-right: 0.4rem;
}

.badge-route {
  background: color-mix(in srgb, var(--color-success) 15%, transparent);
  color: var(--color-success);
}

.option-actions {
  display: flex;
  gap: 0.25rem;
}

.option-details {
  padding: 0.75rem;
  border-top: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
}

.empty-options {
  text-align: center;
  padding: 1rem;
  color: var(--color-text-muted);
  font-size: 0.75rem;
}

.btn-sm {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
}

.btn-icon-sm {
  width: 24px;
  height: 24px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.875rem;
  background: transparent;
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
}

.btn-icon-sm:hover {
  background: var(--color-bg-secondary);
}

.btn-icon-sm.danger:hover {
  background: rgba(var(--color-error-rgb), 0.12);
  color: var(--color-error);
}

.full-width {
  width: 100%;
}

/* Image Upload */
.image-preview {
  position: relative;
  margin-bottom: 0.75rem;
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--color-bg-tertiary);
}

.image-preview img {
  width: 100%;
  max-height: 300px;
  object-fit: contain;
}

.btn-remove-image {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  width: 24px;
  height: 24px;
  padding: 0;
  background: rgba(0, 0, 0, 0.6);
  color: white;
  border-radius: 50%;
  font-size: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: none;
}

.btn-remove-image:hover {
  background: var(--color-error);
}

.file-upload-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: var(--color-bg-tertiary);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 0.875rem;
  color: var(--color-text-secondary);
  transition: all var(--transition-fast);
  width: 100%;
}

.file-upload-btn:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background: rgba(var(--color-accent-rgb), 0.08);
}

/* Routing Rules */
.routing-rules-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.routing-rule-item {
  padding: 0.5rem 0.75rem;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.routing-rule-item:hover {
  border-color: var(--color-accent);
}

.routing-rule-item.editing {
  border-color: var(--color-accent);
}

.rule-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
}

.rule-label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.rule-type-badge {
  font-size: 0.65rem;
  font-weight: 700;
  padding: 0.1rem 0.35rem;
  border-radius: 3px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  flex-shrink: 0;
}

.badge-checkbox {
  background: color-mix(in srgb, var(--color-accent) 15%, transparent);
  color: var(--color-accent);
}

.badge-var {
  background: color-mix(in srgb, var(--color-purple) 15%, transparent);
  color: var(--color-purple);
}

.badge-fx {
  background: color-mix(in srgb, var(--color-warning) 18%, transparent);
  color: var(--color-warning);
}

/* ── Routing toggle ─────────────────────────────────────────────────────── */
.rule-routing-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 0.6rem;
  padding: 0.5rem 0.6rem;
  background: var(--color-bg-primary);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  gap: 0.5rem;
}

.toggle-label {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  cursor: default;
}

.toggle-text {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.toggle-description {
  font-size: 0.65rem;
  color: var(--color-text-muted);
  line-height: 1.3;
}

/* The switch track */
.toggle-switch {
  position: relative;
  width: 36px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 10px;
  background: var(--color-grey-400);
  cursor: pointer;
  flex-shrink: 0;
  transition: background var(--transition-fast);
}

.toggle-switch.active {
  background: var(--color-accent);
}

.toggle-switch:hover:not(.active) {
  background: var(--color-grey-500);
}

/* The sliding thumb */
.toggle-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.25);
  transition: left var(--transition-fast);
  pointer-events: none;
}

.toggle-switch.active .toggle-thumb {
  left: 19px;
}

.group-header-actions {
  display: flex;
  gap: 0.35rem;
}

.rule-number {
  font-weight: 600;
  font-size: 0.8rem;
  color: var(--color-text-primary);
}

.rule-details {
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--color-border);
}

.rule-condition,
.rule-options,
.rule-target {
  margin-top: 0.5rem;
}

.rule-condition label,
.rule-options label,
.rule-target label {
  display: block;
  font-size: 0.7rem;
  color: var(--color-text-muted);
  margin-bottom: 0.25rem;
}

.rule-condition select,
.rule-target input {
  width: 100%;
  padding: 0.35rem 0.5rem;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 0.8rem;
  color: var(--color-text-primary);
}

.var-rule-condition {
  display: flex;
  gap: 0.35rem;
  align-items: center;
}

.var-rule-condition select {
  flex: 1 1 0;
  min-width: 0;
  width: 0;
  padding: 0.35rem 0.4rem;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 0.8rem;
  color: var(--color-text-primary);
}

.var-rule-condition select.var-op-select {
  flex: 0 0 2.5rem;
  min-width: 0;
  width: 2.5rem;
  text-align-last: center;
  padding: 0.35rem 0.1rem;
}

.add-condition-btn {
  margin-top: 0.3rem;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.var-rule-condition select.var-combinator-select {
  flex: 0 0 3.3rem;
  min-width: 0;
  width: 3rem;
  text-align-last: center;
  padding: 0.35rem 0.1rem;
  font-weight: 600;
  font-size: 0.7rem;
}

.var-rule-condition input.var-val-input {
  flex: 0 0 4rem;
  min-width: 0;
  width: 4rem;
  padding: 0.35rem 0.4rem;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 0.8rem;
  color: var(--color-text-primary);
  text-align: right;
}

.option-checkboxes {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.option-checkbox {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.25rem 0.5rem;
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
}

.option-checkbox input[type="checkbox"] {
  width: auto;
  margin: 0;
}

.empty-rules {
  text-align: center;
  padding: 1rem;
  color: var(--color-text-muted);
  font-size: 0.8rem;
}

/* Variable Effects */
.effects-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.effect-item {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.5rem;
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-sm);
}

.effect-var {
  flex: 1 1 0;
  min-width: 0;
  width: 0;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-accent);
  padding: 0.5rem;
  font-size: 0.8rem;
}

/* Literal mode: value field is fixed 5rem, var fills the rest */
.effect-literal .effect-value {
  flex: 0 0 5rem !important;
  width: 5rem !important;
  max-width: none;
}

.effect-op {
  flex: 0 0 2.4rem;
  width: 2.4rem;
  min-width: 0;
  text-align: center;
  text-align-last: center;
  background: var(--color-accent);
  color: var(--color-night);
  font-weight: 600;
  border: none;
  padding: 0.35rem 0.1rem;
  font-size: 0.85rem;
}

.effect-value {
  flex: 0 0 4rem;
  width: 4rem;
  min-width: 0;
  text-align: center;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  font-family: var(--font-mono);
}

.effect-value-var {
  flex: 1 1 0 !important;
  width: 0 !important;
  min-width: 0 !important;
  padding: 0.5rem !important;
  font-size: 0.8rem !important;
  text-align: left;
  font-family: inherit;
}

.effect-equals {
  font-weight: 600;
  color: var(--color-text-muted);
  font-size: 0.875rem;
  flex-shrink: 0;
  padding: 0 0.1rem;
}

.effect-fn .effect-var {
  flex: 1 1 0;
  min-width: 0;
}

.empty-effects {
  text-align: center;
  padding: 1rem;
  color: var(--color-text-muted);
  font-size: 0.8rem;
}

/* Per-option effects sub-section */
.option-effects,
.rule-effects {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--color-border);
}

.option-effects-header,
.rule-effects-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.option-effects-label,
.rule-effects-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.btn-copy-all {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.5rem 1rem;
  background: linear-gradient(135deg, var(--color-accent), var(--color-accent-hover));
  color: var(--color-night);
  border: none;
  border-radius: var(--radius-sm);
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-copy-all:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(var(--color-accent-rgb), 0.3);
}

.translation-warning {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: linear-gradient(135deg, var(--color-warning), var(--color-warning-hover));
  color: var(--color-night);
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  font-weight: 500;
  margin-bottom: 1rem;
}

.warning-content {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.btn-copy-all-fields {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.5rem 1rem;
  background: rgba(6, 18, 27, 0.12);
  color: var(--color-night);
  border: 1px solid rgba(6, 18, 27, 0.25);
  border-radius: var(--radius-sm);
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-copy-all-fields:hover {
  background: rgba(6, 18, 27, 0.22);
}

@keyframes pulse-warning {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.85; }
}

.warning-icon {
  font-size: 1rem;
}

.image-missing {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  margin-bottom: 0.75rem;
  background: var(--color-bg-tertiary);
  border: 2px dashed var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  font-size: 0.85rem;
  font-style: italic;
}
/* Image Inline Warning */
.image-warning-inline {
  background-color: rgba(var(--color-warning-rgb), 0.12);
  border: 1px solid rgba(var(--color-warning-rgb), 0.4);
  color: var(--color-amber-deep);
  padding: 8px;
  border-radius: var(--radius-sm);
  margin-bottom: 12px;
  font-size: 0.9rem;
}

.warning-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.warning-icon-small {
  font-size: 1.1em;
}

.image-adopt-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.label-small {
  font-size: 0.8rem;
  opacity: 0.8;
}

.adopt-buttons {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.btn-adopt {
  background: #fff;
  border: 1px solid var(--color-warning);
  color: var(--color-amber-deep);
  font-size: 0.75rem;
  padding: 2px 6px;
  border-radius: 3px;
  cursor: pointer;
  text-transform: uppercase;
}

.btn-adopt:hover {
  background: rgba(var(--color-warning-rgb), 0.25);
}

.adopt-group {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
}

.source-select {
  padding: 2px 4px;
  border: 1px solid var(--color-warning);
  border-radius: 3px;
  font-size: 0.8rem;
  background: white;
  color: var(--color-amber-deep);
}

.image-info-inline {
  background-color: rgba(var(--color-accent-rgb), 0.1);
  border: 1px solid rgba(var(--color-accent-rgb), 0.35);
  color: var(--color-accent-deep);
  padding: 8px;
  border-radius: var(--radius-sm);
  margin-bottom: 12px;
  font-size: 0.9rem;
}

.info-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.btn-distribute {
  width: 100%;
  background: #fff;
  border: 1px solid var(--color-accent);
  color: var(--color-accent-deep);
  font-size: 0.8rem;
  padding: 4px 8px;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-distribute:hover {
  background: rgba(var(--color-accent-rgb), 0.18);
}
</style>
