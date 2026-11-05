// NexusFrame: busca de filmes e séries (TMDB via Supabase Edge Function) e lista salva no navegador.

const SUPABASE_URL = "https://uswqdzfmscoypsyghpmp.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzd3FkemZtc2NveXBzeWdocG1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMzMDQ5MTAsImV4cCI6MjEwODg4MDkxMH0.wIegX_ISOlC4tc48RoWUMBE46uloKJhrzJsyeWf3veg";
const SEARCH_URL = `${SUPABASE_URL}/functions/v1/movie-search`;
const STORAGE_KEY = "nexusframe:saved-movies";
const TERM_MIN_LENGTH = 2;
const TERM_MAX_LENGTH = 100;
const TYPE_LABELS = { movie: "Filme", tv: "Série" };

const dom = {
  searchForm: document.querySelector("#search-form"),
  searchInput: document.querySelector("#search-input"),
  searchButton: document.querySelector("#search-button"),
  searchStatus: document.querySelector("#search-status"),
  typeFilter: document.querySelector("#type-filter"),
  resultsGrid: document.querySelector("#results-grid"),
  resultCount: document.querySelector("#result-count"),
  savedGrid: document.querySelector("#saved-grid"),
  savedCount: document.querySelector("#saved-count"),
  listSearch: document.querySelector("#list-search"),
  toast: document.querySelector("#toast"),
};

let savedMovies = loadSavedMovies();
let searchResults = [];
let searchState = "idle";
let searchErrorMessage = "";
let typeFilter = "all";
let searchRequestId = 0;
let toastTimer = 0;
let editingId = null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => dom.toast.classList.remove("show"), 2600);
}

function isSavedMovie(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    Array.isArray(value.cast)
  );
}

function loadSavedMovies() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isSavedMovie) : [];
  } catch {
    return [];
  }
}

function persistSavedMovies() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedMovies));
  } catch {
    showToast("Não foi possível guardar a lista neste navegador.");
  }
}

function isSaved(id) {
  return savedMovies.some((movie) => movie.id === id);
}

async function requestSearch(term) {
  const url = new URL(SEARCH_URL);
  url.searchParams.set("action", "search");
  url.searchParams.set("q", term);

  let response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY },
    });
  } catch {
    throw new Error("Não foi possível conectar à base de filmes. Verifique sua internet.");
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof body?.error === "string" ? body.error : "Não foi possível concluir a busca. Tente novamente.";
    throw new Error(message);
  }
  if (!Array.isArray(body?.results)) {
    throw new Error("Resposta inesperada da base de filmes. Tente novamente.");
  }
  return body.results.map(normalizeTitle);
}

function normalizeTitle(raw) {
  return {
    id: String(raw.id),
    tmdbId: Number(raw.tmdbId),
    type: raw.type === "tv" ? "tv" : "movie",
    title: String(raw.title || "Título sem nome"),
    year: typeof raw.year === "number" ? raw.year : null,
    rating: typeof raw.rating === "number" ? raw.rating : null,
    genres: Array.isArray(raw.genres) ? raw.genres.map(String) : [],
    overview: String(raw.overview || ""),
    cast: Array.isArray(raw.cast) ? raw.cast.map(String) : [],
  };
}

function formatRating(rating) {
  if (rating === null) return "Sem nota";
  return `★ ${rating.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
}

function setSearchLoading(isLoading) {
  dom.searchButton.disabled = isLoading;
  dom.searchButton.textContent = isLoading ? "Pesquisando..." : "Pesquisar";
}

function updateSearchStatus() {
  if (searchState === "error") {
    dom.searchStatus.textContent = searchErrorMessage;
  } else if (searchState === "done") {
    const term = dom.searchInput.value.trim();
    dom.searchStatus.textContent = `${searchResults.length} resultado(s) para “${term}”.`;
  }
}

async function handleSearch(event) {
  event.preventDefault();
  const term = dom.searchInput.value.trim();

  if (term.length < TERM_MIN_LENGTH || term.length > TERM_MAX_LENGTH) {
    dom.searchStatus.textContent = `Digite entre ${TERM_MIN_LENGTH} e ${TERM_MAX_LENGTH} caracteres para pesquisar.`;
    dom.searchInput.focus();
    return;
  }

  const requestId = ++searchRequestId;
  searchState = "loading";
  setSearchLoading(true);
  dom.searchStatus.textContent = "Buscando títulos...";
  renderResults();

  try {
    const results = await requestSearch(term);
    if (requestId !== searchRequestId) return;
    searchResults = results;
    searchState = "done";
  } catch (error) {
    if (requestId !== searchRequestId) return;
    searchResults = [];
    searchErrorMessage = error instanceof Error ? error.message : "Erro inesperado. Tente novamente.";
    searchState = "error";
  }

  setSearchLoading(false);
  renderResults();
  updateSearchStatus();
}

function createEmptyState(title, message) {
  const box = el("div", "empty-state");
  box.append(el("h3", "", title), el("p", "", message));
  return box;
}

function createCard(item, footer) {
  const card = el("article", "movie-card");

  const band = el("div", "card-band");
  band.append(el("span", "", item.title.charAt(0).toUpperCase()));

  const content = el("div", "card-content");
  const metaParts = [TYPE_LABELS[item.type], item.year ?? "Ano não informado", formatRating(item.rating)];
  content.append(el("h3", "card-title", item.title), el("p", "card-meta", metaParts.join(" • ")));

  if (item.genres.length > 0) {
    const genres = el("ul", "genre-list");
    genres.setAttribute("aria-label", "Gêneros");
    item.genres.forEach((genre) => genres.append(el("li", "genre-tag", genre)));
    content.append(genres);
  }

  content.append(el("p", "card-description", item.overview || "Sinopse não disponível."));

  const cast = el("p", "card-cast");
  cast.append(el("strong", "", "Elenco principal: "), document.createTextNode(item.cast.join(", ") || "Não informado"));
  content.append(cast);

  card.append(band, content, footer);
  return card;
}

function wrapAction(button) {
  const wrapper = el("div", "card-actions");
  wrapper.append(button);
  return wrapper;
}

function buildAddButton(item) {
  const saved = isSaved(item.id);
  const button = el("button", "small-button", saved ? "✓ Na sua lista" : "＋ Adicionar à lista");
  button.type = "button";
  button.disabled = saved;
  button.addEventListener("click", () => addToList(item));
  return wrapAction(button);
}

function buildRemoveButton(movie) {
  const button = el("button", "small-button danger", "Remover da lista");
  button.type = "button";
  button.setAttribute("aria-label", `Remover ${movie.title} da lista`);
  button.addEventListener("click", () => removeSavedMovie(movie.id));
  return wrapAction(button);
}

function renderResults() {
  dom.resultsGrid.replaceChildren();

  if (searchState === "idle") {
    dom.resultCount.textContent = "0 títulos";
    return;
  }

  if (searchState === "loading") {
    dom.resultCount.textContent = "Buscando...";
    for (let index = 0; index < 8; index += 1) {
      dom.resultsGrid.append(el("div", "movie-card skeleton"));
    }
    return;
  }

  if (searchState === "error") {
    dom.resultCount.textContent = "Falha na busca";
    dom.resultsGrid.append(createEmptyState("Não foi possível carregar os resultados", searchErrorMessage));
    return;
  }

  const visible = typeFilter === "all" ? searchResults : searchResults.filter((item) => item.type === typeFilter);
  dom.resultCount.textContent = `${visible.length} ${visible.length === 1 ? "título" : "títulos"}`;

  if (visible.length === 0) {
    dom.resultsGrid.append(createEmptyState("Nenhum resultado", "Tente outro termo ou altere o filtro de tipo."));
    return;
  }

  visible.forEach((item) => dom.resultsGrid.append(createCard(item, buildAddButton(item))));
}

function renderSavedMovies() {
  const term = dom.listSearch.value.trim().toLocaleLowerCase("pt-BR");
  const visible = savedMovies.filter((movie) => movie.title.toLocaleLowerCase("pt-BR").includes(term));

  dom.savedGrid.replaceChildren();
  dom.savedCount.textContent = `${savedMovies.length} ${savedMovies.length === 1 ? "salvo" : "salvos"}`;

  if (visible.length === 0) {
    dom.savedGrid.append(
      savedMovies.length === 0
        ? createEmptyState("Sua lista está vazia", "Pesquise um título e clique em “Adicionar à lista”.")
        : createEmptyState("Nenhum título encontrado", "Altere o texto do filtro para ver outros títulos."),
    );
    return;
  }

  visible.forEach((movie) => {
    const card = movie.id === editingId ? createEditCard(movie) : createCard(movie, buildSavedActions(movie));
    dom.savedGrid.append(card);
  });

  const editInput = dom.savedGrid.querySelector(".edit-form input");
  if (editInput) editInput.focus();
}

// EDITAR (parte "U" do CRUD): troca o card por um formulário com título e sinopse.
function buildSavedActions(movie) {
  const actions = buildRemoveButton(movie);
  const editButton = el("button", "small-button", "Editar");
  editButton.type = "button";
  editButton.setAttribute("aria-label", `Editar ${movie.title}`);
  editButton.addEventListener("click", () => startEditing(movie.id));
  actions.classList.add("card-actions-row");
  actions.prepend(editButton);
  return actions;
}

function createEditCard(movie) {
  const card = el("article", "movie-card editing");
  const form = el("form", "edit-form");
  form.noValidate = true;

  const titleId = `edit-title-${movie.id}`;
  const overviewId = `edit-overview-${movie.id}`;

  const titleLabel = el("label", "edit-label", "Título");
  titleLabel.htmlFor = titleId;
  const titleInput = el("input");
  titleInput.id = titleId;
  titleInput.type = "text";
  titleInput.maxLength = TERM_MAX_LENGTH;
  titleInput.value = movie.title;
  const titleError = el("span", "field-error");
  titleError.setAttribute("role", "alert");

  const overviewLabel = el("label", "edit-label", "Sinopse");
  overviewLabel.htmlFor = overviewId;
  const overviewInput = el("textarea");
  overviewInput.id = overviewId;
  overviewInput.rows = 6;
  overviewInput.value = movie.overview;

  const actions = el("div", "card-actions-row edit-actions");
  const saveButton = el("button", "small-button", "Salvar");
  saveButton.type = "submit";
  const cancelButton = el("button", "small-button danger", "Cancelar");
  cancelButton.type = "button";
  cancelButton.addEventListener("click", cancelEditing);
  actions.append(saveButton, cancelButton);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const newTitle = titleInput.value.trim();
    if (newTitle.length < TERM_MIN_LENGTH) {
      titleError.textContent = `O título precisa ter pelo menos ${TERM_MIN_LENGTH} caracteres.`;
      titleInput.focus();
      return;
    }
    saveEditedMovie(movie.id, newTitle, overviewInput.value.trim());
  });

  form.append(titleLabel, titleInput, titleError, overviewLabel, overviewInput, actions);
  card.append(form);
  return card;
}

function startEditing(id) {
  editingId = id;
  renderSavedMovies();
}

function cancelEditing() {
  editingId = null;
  renderSavedMovies();
}

function saveEditedMovie(id, title, overview) {
  savedMovies = savedMovies.map((entry) => (entry.id === id ? { ...entry, title, overview } : entry));
  editingId = null;
  persistSavedMovies();
  renderSavedMovies();
  showToast(`“${title}” foi atualizado na sua lista.`);
}

function addToList(item) {
  if (isSaved(item.id)) return;

  savedMovies = [{ ...item, savedAt: new Date().toISOString() }, ...savedMovies];
  persistSavedMovies();
  renderSavedMovies();
  renderResults();
  showToast(`“${item.title}” foi adicionado à sua lista.`);
}

function removeSavedMovie(id) {
  const movie = savedMovies.find((entry) => entry.id === id);
  if (!movie) return;

  savedMovies = savedMovies.filter((entry) => entry.id !== id);
  persistSavedMovies();
  renderSavedMovies();
  renderResults();
  showToast(`“${movie.title}” foi removido da sua lista.`);
}

dom.searchForm.addEventListener("submit", handleSearch);

dom.typeFilter.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-type]");
  if (!button) return;

  typeFilter = button.dataset.type;
  dom.typeFilter.querySelectorAll("button[data-type]").forEach((chip) => {
    chip.setAttribute("aria-pressed", String(chip === button));
  });
  renderResults();
  updateSearchStatus();
});

dom.listSearch.addEventListener("input", renderSavedMovies);

renderSavedMovies();
