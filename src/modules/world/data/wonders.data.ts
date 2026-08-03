export type WonderEra = "modern" | "ancient" | "natural";

export interface WonderCatalogItem {
  key: string;
  name: string;
  country: string;
  era: WonderEra;
}

export const WONDERS_CATALOG: WonderCatalogItem[] = [
  { key: "great_wall_china", name: "Gran Muralla China", country: "CN", era: "modern" },
  { key: "petra", name: "Petra", country: "JO", era: "modern" },
  { key: "christ_redeemer", name: "Cristo Redentor", country: "BR", era: "modern" },
  { key: "machu_picchu", name: "Machu Picchu", country: "PE", era: "modern" },
  { key: "chichen_itza", name: "Chichén Itzá", country: "MX", era: "modern" },
  { key: "colosseum", name: "Coliseo", country: "IT", era: "modern" },
  { key: "taj_mahal", name: "Taj Mahal", country: "IN", era: "modern" },
  { key: "great_pyramid_giza", name: "Gran Pirámide de Guiza", country: "EG", era: "ancient" },
  { key: "hanging_gardens_babylon", name: "Jardines Colgantes de Babilonia", country: "IQ", era: "ancient" },
  { key: "statue_zeus", name: "Estatua de Zeus", country: "GR", era: "ancient" },
  { key: "temple_artemis", name: "Templo de Artemisa", country: "TR", era: "ancient" },
  { key: "mausoleum_halicarnassus", name: "Mausoleo de Halicarnaso", country: "TR", era: "ancient" },
  { key: "colossus_rhodes", name: "Coloso de Rodas", country: "GR", era: "ancient" },
  { key: "lighthouse_alexandria", name: "Faro de Alejandría", country: "EG", era: "ancient" },
  { key: "amazon_rainforest", name: "Amazonía", country: "BR", era: "natural" },
  { key: "halong_bay", name: "Bahía de Ha Long", country: "VN", era: "natural" },
  { key: "iguazu_falls", name: "Cataratas del Iguazú", country: "AR", era: "natural" },
  { key: "jeju_island", name: "Isla de Jeju", country: "KR", era: "natural" },
  { key: "komodo_island", name: "Isla de Komodo", country: "ID", era: "natural" },
  { key: "puerto_princesa_river", name: "Río Subterráneo de Puerto Princesa", country: "PH", era: "natural" },
  { key: "table_mountain", name: "Montaña de la Mesa", country: "ZA", era: "natural" },
];
