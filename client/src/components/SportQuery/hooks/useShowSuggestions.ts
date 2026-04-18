import { useEffect, useState } from 'react'

const KEY = 'sportquery.showSuggestions'

export function useShowSuggestions(): [boolean, (v: boolean) => void] {
  const [show, setShow] = useState<boolean>(() => {
    return localStorage.getItem(KEY) === 'true'
  })
  useEffect(() => {
    localStorage.setItem(KEY, String(show))
  }, [show])
  return [show, setShow]
}
