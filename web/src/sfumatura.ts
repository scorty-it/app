// La barra delle categorie sul telefono scorre su una riga: invece di tagliare una parola a metà, i bordi dove c'è
// altro da scorrere sfumano (mask-image). Arrivati in fondo l'ultima categoria torna nitida. Funzione pura.
const LARGA = 40 // px di sfumatura

export function sfumatura({ scrollLeft, clientWidth, scrollWidth }: { scrollLeft: number; clientWidth: number; scrollWidth: number }) {
  const prima = scrollLeft > 1
  const dopo = scrollLeft + clientWidth < scrollWidth - 1 // un pixel di tolleranza: lo scorrimento può fermarsi a mezzo pixel
  if (prima && dopo) return `linear-gradient(to right, transparent, #000 ${LARGA}px, #000 calc(100% - ${LARGA}px), transparent)`
  if (dopo) return `linear-gradient(to right, #000 calc(100% - ${LARGA}px), transparent)`
  if (prima) return `linear-gradient(to right, transparent, #000 ${LARGA}px)`
  return undefined
}
