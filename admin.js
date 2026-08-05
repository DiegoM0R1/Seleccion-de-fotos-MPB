// CONFIGURACIÓN DE SUPABASE
const SUPABASE_URL = "https://supabase.com/dashboard/project/svdfdahvhdmxzyknmicz";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2ZGZkYWh2aGRteHp5a25taWN6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5Mjk1NDQsImV4cCI6MjEwMTUwNTU0NH0.c7OLeFnZQYSYmJtWsmdYry22sEPtPUw2DsEiJPLx_Vk";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ESTADO GLOBAL
let photosState = [];
let eventId = null;
let currentFilter = "all";

// ELEMENTOS DOM
const adminGalleryGrid = document.getElementById("admin-gallery-grid");
const adminEventTitle = document.getElementById("admin-event-title");
const realtimeBadge = document.getElementById("realtime-badge");

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

// Acciones y Modal
const downloadSelectedBtn = document.getElementById("download-selected-btn");
const finalizeEventBtn = document.getElementById("finalize-event-btn");
const finalizeModal = document.getElementById("finalize-modal");
const cancelFinalizeBtn = document.getElementById("cancel-finalize-btn");
const confirmArchiveBtn = document.getElementById("confirm-archive-btn");
const confirmDeleteBtn = document.getElementById("confirm-delete-btn");

// INICIALIZACIÓN
document.addEventListener("DOMContentLoaded", async () => {
  const urlParams = new URLSearchParams(window.location.search);
  eventId = urlParams.get("evento");

  if (!eventId) {
    adminEventTitle.textContent = "Error: Falta ID del evento";
    return;
  }

  await fetchEventData();
  await fetchPhotos();
  setupRealtimeSubscription();
  setupEventListeners();
});

// 1. Cargar datos del evento y fotos
async function fetchEventData() {
  const { data } = await supabase.from("eventos").select("nombre").eq("id", eventId).single();
  if (data) adminEventTitle.textContent = `Panel: ${data.nombre}`;
}

async function fetchPhotos() {
  const { data, error } = await supabase
    .from("fotografias")
    .select("*")
    .eq("evento_id", eventId)
    .order("numero", { ascending: true });

  if (!error && data) {
    photosState = data;
    updateUI();
  }
}
// Función para redimensionar fotos en el navegador usando Canvas (reemplaza a Pillow de Python)
function createBrowserThumbnail(file, maxWidth = 600) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const scaleFactor = maxWidth / img.width;
        
        if (scaleFactor < 1) {
          canvas.width = maxWidth;
          canvas.height = img.height * scaleFactor;
        } else {
          canvas.width = img.width;
          canvas.height = img.height;
        }

        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        canvas.toBlob((blob) => {
          resolve(blob);
        }, "image/jpeg", 0.8); // Calidad 80%
      };
    };
  });
}

// Proceso completo de creación del evento directamente en la Web
async function handleWebUpload(eventName, files) {
  const progressBar = document.getElementById("upload-progress-bar");
  const progressText = document.getElementById("upload-status-text");
  const progressContainer = document.getElementById("upload-progress-container");

  progressContainer.classList.remove("hidden");

  // 1. Crear el Evento en Supabase
  const { data: eventData, error: eventError } = await supabase
    .from("eventos")
    .insert([{ nombre: eventName, estado: "activo" }])
    .select()
    .single();

  if (eventError) {
    alert("Error al crear el evento");
    return;
  }

  const newEventId = eventData.id;
  const fileArray = Array.from(files).sort((a, b) => a.name.localeCompare(b.name));
  const totalFiles = fileArray.length;

  // 2. Subir fotos a Supabase Storage (o Google Drive vía API)
  for (let i = 0; i < totalFiles; i++) {
    const file = fileArray[i];
    const photoNumber = i + 1;
    progressText.textContent = `Procesando Foto ${photoNumber} de ${totalFiles}...`;

    // Generar la miniatura ligera en el navegador
    const thumbBlob = await createBrowserThumbnail(file);

    // Subir archivo original y miniatura a Supabase Storage Bucket
    const originalPath = `eventos/${newEventId}/original_${file.name}`;
    const thumbPath = `eventos/${newEventId}/thumb_${file.name}`;

    await supabase.storage.from("fotografias").upload(originalPath, file);
    await supabase.storage.from("fotografias").upload(thumbPath, thumbBlob);

    // Obtener URLs públicas
    const { data: originalUrl } = supabase.storage.from("fotografias").getPublicUrl(originalPath);
    const { data: thumbUrl } = supabase.storage.from("fotografias").getPublicUrl(thumbPath);

    // Guardar registro en la base de datos
    await supabase.from("fotografias").insert([{
      evento_id: newEventId,
      nombre_original: file.name,
      numero: photoNumber,
      drive_file_id: originalPath, // Referencia del path
      thumbnail_url: thumbUrl.publicUrl,
      original_url: originalUrl.publicUrl,
      seleccionada: false,
      publicada: false
    }]);

    progressBar.value = Math.round(((i + 1) / totalFiles) * 100);
  }

  alert("¡Evento creado con éxito!");
  window.location.href = `admin.html?evento=${newEventId}`;
}
// 2. CONFIGURACIÓN DE SINCRONIZACIÓN EN TIEMPO REAL (REALTIME)
function setupRealtimeSubscription() {
  supabase
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
        // Actualizar la foto modificada por el revisor en el estado local
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
        realtimeBadge.textContent = "● En Vivo";
        realtimeBadge.className = "status-badge connected";
      }
    });
}

// Visual feedback de animación cuando cambia una foto
function flashCard(photoId) {
  const card = document.querySelector(`[data-photo-id="${photoId}"]`);
  if (card) {
    card.style.transition = "transform 0.2s, box-shadow 0.2s";
    card.style.transform = "scale(1.05)";
    setTimeout(() => { card.style.transform = "scale(1)"; }, 300);
  }
}

// 3. Renderizado y Métricas
function updateUI() {
  updateMetricsAndCounts();
  renderAdminGallery();
}

function updateMetricsAndCounts() {
  const total = photosState.length;
  const selected = photosState.filter(p => p.seleccionada).length;
  const unselected = total - selected;
  const published = photosState.filter(p => p.publicada).length;

  metricTotal.textContent = total;
  metricSelected.textContent = selected;
  metricPublished.textContent = published;
  btnSelectedCount.textContent = selected;

  filterCountAll.textContent = total;
  filterCountSelected.textContent = selected;
  filterCountUnselected.textContent = unselected;
  filterCountPublished.textContent = published;
}

function renderAdminGallery() {
  adminGalleryGrid.innerHTML = "";

  // Filtrado
  const filteredPhotos = photosState.filter(photo => {
    if (currentFilter === "selected") return photo.seleccionada;
    if (currentFilter === "unselected") return !photo.seleccionada;
    if (currentFilter === "published") return photo.publicada;
    return true; // "all"
  });

  filteredPhotos.forEach(photo => {
    const card = document.createElement("div");
    card.className = `photo-card ${photo.seleccionada ? "selected" : ""}`;
    card.setAttribute("data-photo-id", photo.id);
    const formattedNum = String(photo.numero).padStart(3, "0");

    card.innerHTML = `
      <div class="admin-card-actions">
        <button class="tag-btn ${photo.publicada ? 'is-published' : ''}" onclick="togglePublished('${photo.id}')">
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

// 4. Marcar Estado: Publicada
async function togglePublished(photoId) {
  const photo = photosState.find(p => p.id === photoId);
  if (!photo) return;

  const newStatus = !photo.publicada;
  photo.publicada = newStatus;
  updateUI();

  await supabase.from("fotografias").update({ publicada: newStatus }).eq("id", photoId);
}

// 5. Descarga de Fotografías Seleccionadas
downloadSelectedBtn.addEventListener("click", () => {
  const selectedPhotos = photosState.filter(p => p.seleccionada);
  
  if (selectedPhotos.length === 0) {
    alert("No hay fotografías seleccionadas para descargar.");
    return;
  }

  // Generar un archivo de texto/lista para el fotógrafo con las URLs directas
  const downloadList = selectedPhotos
    .map(p => `Foto ${String(p.numero).padStart(3, "0")}: ${p.original_url}`)
    .join("\n");

  const blob = new Blob([downloadList], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `seleccion_evento_${eventId.substring(0, 8)}.txt`;
  a.click();

  // Abrir también pestañas individuales si son menos de 10 fotos
  if (selectedPhotos.length <= 10) {
    selectedPhotos.forEach(p => window.open(p.original_url, "_blank"));
  }
});

// 6. Finalizar Evento
finalizeEventBtn.addEventListener("click", () => finalizeModal.classList.remove("hidden"));
cancelFinalizeBtn.addEventListener("click", () => finalizeModal.classList.add("hidden"));

confirmArchiveBtn.addEventListener("click", async () => {
  await supabase.from("eventos").update({ estado: "archivado" }).eq("id", eventId);
  alert("Evento archivado correctamente.");
  window.location.reload();
});

confirmDeleteBtn.addEventListener("click", async () => {
  if (confirm("⚠️ ¿Estás seguro de eliminar permanentemente el evento y todos sus registros?")) {
    await supabase.from("eventos").delete().eq("id", eventId);
    alert("Evento eliminado.");
    window.location.href = "index.html";
  }
});

// Event Listeners para Filtros
function setupEventListeners() {
  filterTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      filterTabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      currentFilter = tab.dataset.filter;
      renderAdminGallery();
    });
  });
}
