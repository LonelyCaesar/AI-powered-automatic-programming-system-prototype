<template>
  <main class="login-shell">
    <section class="login-card">
      <div class="brand-block">
        <img :src="logoUrl" class="login-logo" alt="Cubi Code" />
        <div>
          <p class="eyebrow">Cubi Code AI</p>
          <h1>登入 AI 寫程式系統</h1>
        </div>
      </div>

      <form class="login-form" @submit.prevent="submitLogin">
        <label>
          <span>帳號</span>
          <input
            v-model.trim="username"
            type="text"
            autocomplete="username"
            placeholder="請輸入帳號"
            :disabled="isSubmitting"
            autofocus
          />
        </label>

        <label>
          <span>密碼</span>
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
            placeholder="請輸入密碼"
            :disabled="isSubmitting"
          />
        </label>

        <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>

        <button class="login-button" type="submit" :disabled="isSubmitting">
          {{ isSubmitting ? '登入中...' : '登入系統' }}
        </button>
      </form>
    </section>
  </main>
</template>

<script setup>
import { ref } from 'vue'
import { apiPost } from '../api/client'
import logoUrl from '../assets/cubi-logo.svg?url'

defineProps({ loading: Boolean })
const emit = defineEmits(['login'])

const username = ref('')
const password = ref('')
const errorMessage = ref('')
const isSubmitting = ref(false)

async function submitLogin() {
  errorMessage.value = ''

  if (!username.value || !password.value) {
    errorMessage.value = '請輸入帳號與密碼。'
    return
  }

  isSubmitting.value = true

  try {
    const data = await apiPost('/api/auth/login', {
      username: username.value,
      password: password.value
    })
    emit('login', data)
  } catch (err) {
    errorMessage.value = err?.message || '登入失敗，請確認帳號密碼。'
  } finally {
    isSubmitting.value = false
  }
}
</script>

<style scoped>
.login-shell {
  width: 100vw;
  height: 100vh;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background:
    radial-gradient(circle at top left, rgba(108, 99, 255, .18), transparent 34%),
    linear-gradient(135deg, #f8fbff 0%, #eef4ff 48%, #f7f9fc 100%);
}

.login-card {
  width: min(460px, 100%);
  padding: 34px;
  border: 1px solid #dfe7f4;
  border-radius: 22px;
  background: rgba(255, 255, 255, .94);
  box-shadow: 0 24px 70px rgba(15, 23, 42, .13);
}

.brand-block {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-bottom: 30px;
}

.login-logo {
  width: 58px;
  height: 58px;
  flex: 0 0 auto;
}

.eyebrow {
  margin: 0 0 4px;
  color: #6c63ff;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: .08em;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  color: #0f172a;
  font-size: 27px;
  line-height: 1.25;
}

.subtitle {
  margin: 8px 0 0;
  color: #64748b;
  font-size: 14px;
  line-height: 1.6;
}

.login-form {
  display: grid;
  gap: 18px;
}

label {
  display: grid;
  gap: 8px;
  color: #334155;
  font-size: 14px;
  font-weight: 800;
}

input {
  width: 100%;
  height: 48px;
  padding: 0 14px;
  border: 1px solid #dbe5f3;
  border-radius: 12px;
  outline: none;
  background: #fff;
  color: #0f172a;
  font-size: 15px;
  transition: border-color .15s ease, box-shadow .15s ease;
}

input:focus {
  border-color: #6c63ff;
  box-shadow: 0 0 0 4px rgba(108, 99, 255, .13);
}

.error-text {
  margin: -4px 0 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: #fff1f1;
  color: #c0362c;
  font-size: 14px;
  font-weight: 700;
}

.login-button {
  height: 50px;
  border: 0;
  border-radius: 12px;
  background: #111827;
  color: #fff;
  font-size: 16px;
  font-weight: 900;
  box-shadow: 0 14px 28px rgba(17, 24, 39, .18);
}

.login-button:disabled {
  opacity: .7;
}

</style>
