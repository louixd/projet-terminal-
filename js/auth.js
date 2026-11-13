
import { supabase } from './supabase.js';

// REGISTER
export async function register(email, password) {

    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            emailRedirectTo: new URL('../pages/dashboard.html', import.meta.url).href
        }
    });

    if (error) throw error;

    return data;
}

// LOGIN
export async function login(email, password) {

    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
    });

    if (error) throw error;

    return data;
}


// LOGOUT
export async function logout() {

    const { error } = await supabase.auth.signOut();

    if (error) throw error;
}

// GET CURRENT USER
export async function getCurrentUser() {

    const { data, error } = await supabase.auth.getUser();

    if (error) throw error;

    return data.user;
}

// FORGOT PASSWORD
export async function forgotPassword(email) {

    const { error } =
        await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: new URL('../pages/reset-password.html', import.meta.url).href
        });

    if (error) throw error;
}

// UPDATE PASSWORD
export async function updatePassword(password) {

    const { error } = await supabase.auth.updateUser({
        password
    });

    if (error) throw error;
}
