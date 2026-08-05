// CONFIGURACIÓN DE SUPABASE
const SUPABASE_URL = "https://svdfdahvhdmxzyknmicz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2ZGZkYWh2aGRteHp5a25taWN6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5Mjk1NDQsImV4cCI6MjEwMTUwNTU0NH0.c7OLeFnZQYSYmJtWsmdYry22sEPtPUw2DsEiJPLx_Vk";

if (!window.dbClient) {
  window.dbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
var supabase = window.dbClient;

// ESTADO GLOBAL
let photosState = [];
let eventId = null;
let currentFilter = "all";
let realtimeChannel = null;

// ELEMENTOS DOM
const adminGalleryGrid = document.getElementById("admin-gallery-grid");
const adminEventSelect = document.getElementById("admin-event-select");
const realtimeBadge = document.getElementById("realtime-badge");
const copyLinkBtn = document.getElementById("copy-link-btn");

// Métricas
const metricTotal = document.getElementById("metric-total");
const metricSelected = document.getElementById("metric-selected");
const metricPublished = document.getElementById("metric-published");
const btnSelectedCount = document.getElementById("btn-selected-count");

// Filtros
const filterTabs = document.querySelectorAll(".filter-tab");
const filterCountAll = document.getElementById("filter-count-all");
const filterCountSelected = document.getElementById("filter-count-selected");
const filterCountUnselected = document.getElementById("filter-count-unselected");
const filterCountPublished = document.getElementById("filter-count-published");

// Modales y Acciones
const downloadSelectedBtn = document.getElementById("download-selected-btn");
const finalizeEventBtn = document.getElementById("finalize-event-btn");
const finalizeModal = document.getElementById("finalize-modal");
const cancelFinalizeBtn = document.getElementById("cancel-finalize-btn");
const confirmArchiveBtn = document.getElementById("confirm-archive-btn");
const confirmDeleteBtn = document.getElementById("confirm-delete-btn");

const createModal = document.getElementById("create-event-modal");
const openModalBtn = document.getElementById("open-create-modal-btn");
const closeModalBtn = document.getElementById("close-create-modal-btn");
const startUploadBtn = document.getElementById("start-upload-btn");

// INICIALIZACIÓN
document.addEventListener("DOMContentLoaded", async () => {
  setupEventListeners();
  await loadAllAdminEvents();
});

// 1. CARGAR TODOS LOS EVENTOS EN EL SELECTOR
async function loadAllAdminEvents() {
  if (!adminEventSelect) return;

  adminEventSelect.innerHTML = '<option value="">Cargando eventos...</option>';

  const { data: events, error } = await supabase
    .from("eventos")
    .select("id, nombre, estado, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error al cargar eventos:", error);
    updateStatusBadge(false, "Sin conexión");
    adminEventSelect.innerHTML = '<option value="">Error de conexión</option>';
    return;
  }

  updateStatusBadge(true, "Conectado");

  if (!events || events.length === 0) {
    adminEventSelect.innerHTML = '<option value="">Sin eventos creados</option>';
    eventId = null;
    photosState = [];
    updateUI();
    return;
  }

  // Llenar el menú desplegable
  adminEventSelect.innerHTML = events.map(ev => {
    const estadoTag = ev.estado === "activo" ? "🟢" : "🔴";
    return `<option value="${ev.id}">${estadoTag} ${ev.nombre}</option>`;
  }).join("");

  // Verificar si hay un ID de evento en los parámetros de la URL
  const urlParams = new URLSearchParams(window.location.search);
  const urlEventId = urlParams.get("evento");

  if (urlEventId && events.some(e => e.id === urlEventId)) {
    eventId = urlEventId;
  } else {
    eventId = events[0].id;
  }

  adminEventSelect.value = eventId;
  updateUrlQuery(eventId);

  await fetchPhotos();
  setupRealtimeSubscription();
}

// 2. CARGAR FOTOGRAFÍAS DEL EVENTO SELECCIONADO
async function fetchPhotos() {
  if (!eventId) {
    photosState = [];
    updateUI();
    return;
  }

  const { data, error } = await supabase
    .from("fotografias")
    .select("*")
    .eq("evento_id", eventId)
    .order("numero", { ascending: true });

  if (error) {
    console.error("Error al cargar fotografías:", error);
    return;
  }

  photosState = data || [];
  updateUI();
}

// 3. SUSCRIPCIÓN EN TIEMPO REAL
function setupRealtimeSubscription() {
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  if (!eventId) return;

  realtimeChannel = supabase
    .channel(`admin-event-${eventId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "fotografias",
        filter: `evento_id=eq.${eventId}`
      },
      (payload) => {
        const index = photosState.findIndex(p => p.id === payload.new.id);
        if (index !== -1) {
          photosState[index] = payload.new;
          updateUI();
          flashCard(payload.new.id);
        }
      }
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        updateStatusBadge(true, "● En Vivo");
      } else {
        updateStatusBadge(false, "Desconectado");
      }
    });
}

// 4. ACTUALIZAR INTERFAZ Y MÉTRICAS
function updateUI() {
  updateMetricsAndCounts();
  renderAdminGallery();
}

function updateMetricsAndCounts() {
  const total = photosState.length;
  const selected = photosState.filter(p => p.seleccionada).length;
  const unselected = total - selected;
  const published = photosState.filter(p => p.publicada).length;

  if (metricTotal) metricTotal.textContent = total;
  if (metricSelected) metricSelected.textContent = selected;
  if (metricPublished) metricPublished.textContent = published;
  if (btnSelectedCount) btnSelectedCount.textContent = selected;

  if (filterCountAll) filterCountAll.textContent = total;
  if (filterCountSelected) filterCountSelected.textContent = selected;
  if (filterCountUnselected) filterCountUnselected.textContent = unselected;
  if (filterCountPublished) filterCountPublished.textContent = published;
}

function renderAdminGallery() {
  if (!adminGalleryGrid) return;
  adminGalleryGrid.innerHTML = "";

  const filteredPhotos = photosState.filter(photo => {
    if (currentFilter === "selected") return photo.seleccionada;
    if (currentFilter === "unselected") return !photo.seleccionada;
    if (currentFilter === "published") return photo.publicada;
    return true;
  });

  if (filteredPhotos.length === 0) {
    adminGalleryGrid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: #64748b;">
        No hay fotos que mostrar en esta categoría.
      </div>`;
    return;
  }

  filteredPhotos.forEach(photo => {
    const card = document.createElement("div");
    card.className = `photo-card ${photo.seleccionada ? "selected" : ""}`;
    card.setAttribute("data-photo-id", photo.id);
    const formattedNum = String(photo.numero).padStart(3, "0");

    card.innerHTML = `
      <div class="admin-card-actions">
        <button class="tag-btn ${photo.publicada ? 'is-published' : ''}" onclick="window.togglePublished('${photo.id}')">
          ${photo.publicada ? '✓ Publicada' : 'Marcar Publicada'}
        </button>
      </div>
      <img src="${photo.thumbnail_url}" alt="Foto ${formattedNum}" loading="lazy">
      <div class="check-indicator">${photo.seleccionada ? "✓" : ""}</div>
      <div class="photo-badge">Foto ${formattedNum}</div>
    `;

    adminGalleryGrid.appendChild(card);
  });
}

// 5. MARCAR / DESMARCAR COMO PUBLICADA
window.togglePublished = async function(photoId) {
  const photo = photosState.find(p => p.id === photoId);
  if (!photo) return;

  const newStatus = !photo.publicada;
  photo.publicada = newStatus;
  updateUI();

  const { error } = await supabase.from("fotografias").update({ publicada: newStatus }).eq("id", photoId);
  if (error) {
    console.error("Error al actualizar estado de publicación:", error);
    photo.publicada = !newStatus; // Revertir si hay error
    updateUI();
  }
  };

// 6. SUBIDA DE NUEVO EVENTO Y FOTOGRAFÍAS
startUploadBtn?.addEventListener("click", async () => {
  const nameInput = document.getElementById("new-event-name");
  const filesInput = document.getElementById("event-photos-input");
  const progressContainer = document.getElementById("upload-progress-container");
  const progressBar = document.getElementById("upload-progress-bar");
  const statusText = document.getElementById("upload-status-text");

  const eventName = nameInput.value.trim();
  const files = Array.from(filesInput.files).sort((a, b) => a.name.localeCompare(b.name));

  if (!eventName) return alert("Ingresa un nombre para el evento");
  if (files.length === 0) return alert("Selecciona al menos una fotografía");

  startUploadBtn.disabled = true;
  progressContainer.classList.remove("hidden");

  try {
    // Crear el evento en BD
    const { data: eventData, error: eventError } = await supabase
      .from("eventos")
      .insert([{ nombre: eventName, estado: "activo" }])
      .select()
      .single();

    if (eventError) throw new Error("Error en BD (Eventos): " + eventError.message);

    const newEventId = eventData.id;
    const total = files.length;

    for (let i = 0; i < total; i++) {
      const file = files[i];
      const photoNum = i + 1;
      
      statusText.textContent = `Procesando Foto ${photoNum} de ${total}...`;

      const thumbBlob = await generateThumbnail(file);

      const cleanName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
      const timeStamp = Date.now();
      const origPath = `eventos/${newEventId}/orig_${timeStamp}_${cleanName}`;
      const thumbPath = `eventos/${newEventId}/thumb_${timeStamp}_${cleanName}`;

      const { error: origErr } = await supabase.storage.from("fotografias").upload(origPath, file);
      if (origErr) throw new Error(`Error al subir Foto Original ${photoNum}: ${origErr.message}`);

      const { error: thumbErr } = await supabase.storage.from("fotografias").upload(thumbPath, thumbBlob);
      if (thumbErr) throw new Error(`Error al subir Miniatura ${photoNum}: ${thumbErr.message}`);

      const { data: origUrl } = supabase.storage.from("fotografias").getPublicUrl(origPath);
      const { data: thumbUrl } = supabase.storage.from("fotografias").getPublicUrl(thumbPath);

      const { error: photoDbErr } = await supabase.from("fotografias").insert([{
        evento_id: newEventId,
        nombre_original: file.name,
        numero: photoNum,
        thumbnail_url: thumbUrl.publicUrl,
        original_url: origUrl.publicUrl,
        seleccionada: false,
        publicada: false
      }]);

      if (photoDbErr) throw new Error(`Error al registrar Foto ${photoNum} en BD: ${photoDbErr.message}`);

      const percent = Math.round(((i + 1) / total) * 100);
      progressBar.style.width = `${percent}%`;
    }

    alert("¡Evento y fotografías creados con éxito!");
    
    nameInput.value = "";
    filesInput.value = "";
    progressContainer.classList.add("hidden");
    createModal.classList.add("hidden");

    window.location.href = `admin.html?evento=${newEventId}`;

  } catch (err) {
    console.error(err);
    alert("⚠️ " + err.message);
  } finally {
    startUploadBtn.disabled = false;
  }
});

// 7. COMPRESIÓN DE MINIATURAS EN NAVEGADOR
function generateThumbnail(file, maxWidth = 600) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
      const img = new Image();
      img.src = e.target.result;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const scale = maxWidth / img.width;
        
        canvas.width = scale < 1 ? maxWidth : img.width;
        canvas.height = scale < 1 ? img.height * scale : img.height;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Error al generar la miniatura"));
        }, "image/jpeg", 0.8);
      };
      img.onerror = () => reject(new Error("Error al cargar la imagen seleccionada"));
    };
    reader.onerror = () => reject(new Error("Error al leer el archivo local"));
  });
}

// 8. FUNCIONES AUXILIARES Y LISTENERS
function setupEventListeners() {
  // Cambio en el selector de eventos
  adminEventSelect?.addEventListener("change", async (e) => {
    eventId = e.target.value;
    if (eventId) {
      updateUrlQuery(eventId);
      await fetchPhotos();
      setupRealtimeSubscription();
    }
  });

  // Copiar link para el Alcalde
  copyLinkBtn?.addEventListener("click", () => {
    if (!eventId) {
      alert("Selecciona o crea un evento primero.");
      return;
    }
    const baseUrl = window.location.origin + window.location.pathname.replace("admin.html", "");
    const publicUrl = `${baseUrl}index.html?evento=${eventId}`;
    
    navigator.clipboard.writeText(publicUrl).then(() => {
      alert("¡Enlace del evento copiado al portapapeles!\n\n" + publicUrl);
    }).catch(() => {
      prompt("Copia este enlace manualmente:", publicUrl);
    });
  });

  // Abrir / Cerrar Modal de Creación
  openModalBtn?.addEventListener("click", () => createModal?.classList.remove("hidden"));
  closeModalBtn?.addEventListener("click", () => createModal?.classList.add("hidden"));

  // Pestañas de Filtros
  filterTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      filterTabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      currentFilter = tab.dataset.filter;
      renderAdminGallery();
    });
  });

  // Botón Descargar Seleccionadas
  downloadSelectedBtn?.addEventListener("click", () => {
    const selectedPhotos = photosState.filter(p => p.seleccionada);
    
    if (selectedPhotos.length === 0) {
      alert("No hay fotografías seleccionadas por el Alcalde para descargar.");
      return;
    }

    const downloadList = selectedPhotos
      .map(p => `Foto ${String(p.numero).padStart(3, "0")}: ${p.original_url}`)
      .join("\n");

    const blob = new Blob([downloadList], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `seleccion_evento_${eventId.substring(0, 8)}.txt`;
    a.click();

    if (selectedPhotos.length <= 10) {
      selectedPhotos.forEach(p => window.open(p.original_url, "_blank"));
    }
  });

  // Finalizar Evento Modal
  finalizeEventBtn?.addEventListener("click", () => finalizeModal?.classList.remove("hidden"));
  cancelFinalizeBtn?.addEventListener("click", () => finalizeModal?.classList.add("hidden"));

  confirmArchiveBtn?.addEventListener("click", async () => {
    if (!eventId) return;
    await supabase.from("eventos").update({ estado: "archivado" }).eq("id", eventId);
    alert("Evento archivado correctamente.");
    finalizeModal?.classList.add("hidden");
    await loadAllAdminEvents();
  });

  confirmDeleteBtn?.addEventListener("click", async () => {
    if (!eventId) return;
    if (confirm("⚠️ ¿Estás seguro de eliminar permanentemente el evento y todas sus fotos?")) {
      await supabase.from("eventos").delete().eq("id", eventId);
      alert("Evento eliminado.");
      finalizeModal?.classList.add("hidden");
      await loadAllAdminEvents();
    }
  });
}

function updateStatusBadge(online, text) {
  if (!realtimeBadge) return;
  realtimeBadge.textContent = text;
  realtimeBadge.className = online ? "status-badge connected" : "status-badge connecting";
}

function updateUrlQuery(id) {
  if (!id) return;
  const newUrl = `${window.location.pathname}?evento=${id}`;
  window.history.replaceState({ path: newUrl }, "", newUrl);
}

function flashCard(photoId) {
  const card = document.querySelector(`[data-photo-id="${photoId}"]`);
  if (card) {
    card.style.transition = "transform 0.2s, box-shadow 0.2s";
    card.style.transform = "scale(1.04)";
    setTimeout(() => { card.style.transform = "scale(1)"; }, 300);
  }
}