import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
 
// URL do seu projeto (já preenchida)
const SUPABASE_URL = 'https://sqzqlpoprstxkikjckox.supabase.co';
 
// Cole aqui a chave "anon" ou "publishable" (Project Settings -> API Keys).
// Essa chave é pública por design: quem protege os dados são as políticas RLS do banco.
// NUNCA coloque aqui a chave "service_role" / "secret".
const SUPABASE_KEY = 'sb_publishable_h7iijoudtksY-tGopkACdw_7NWHGv30';
 
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true, // renova o token JWT automaticamente
    persistSession: true,
    detectSessionInUrl: false,
  },
});