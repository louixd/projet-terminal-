
import { createClient } from
'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// Informations de ton projet Supabase
const SUPABASE_URL = 'https://bxayvygrogqaomlfhktq.supabase.co';

const SUPABASE_KEY = 'sb_publishable_LJPFr1VBJbjgAqjWW7NMZg_caQsDCvg';

// Connexion à Supabase
export const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);
