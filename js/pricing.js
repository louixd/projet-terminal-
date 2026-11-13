const toggleBtn = document.getElementById('pricing-toggle');
const amounts = document.querySelectorAll('.amount');
const labelMonthly = document.getElementById('label-monthly');
const labelAnnually = document.getElementById('label-annually');

// Sayfa ilk yüklendiğinde "Monthly" yazısını aktif renkte başlatıyoruz
labelMonthly.classList.add('active');

toggleBtn.addEventListener('change', () => {
  if (toggleBtn.checked) {
    // Yıllık seçili
    labelMonthly.classList.remove('active');
    labelAnnually.classList.add('active');
    
    amounts.forEach(amount => {
      // Değerleri data-annually attribute'undan çekiyoruz
      amount.textContent = amount.getAttribute('data-annually');
      
      // Rakam değişiminde ufak bir parlayıp gelme animasyonu
      amount.style.opacity = '0';
      setTimeout(() => {
        amount.style.opacity = '1';
        amount.style.transition = 'opacity 0.3s ease';
      }, 50);
    });
  } else {
    // Aylık seçili
    labelAnnually.classList.remove('active');
    labelMonthly.classList.add('active');
    
    amounts.forEach(amount => {
      // Değerleri data-monthly attribute'undan çekiyoruz
      amount.textContent = amount.getAttribute('data-monthly');
      
      amount.style.opacity = '0';
      setTimeout(() => {
        amount.style.opacity = '1';
        amount.style.transition = 'opacity 0.3s ease';
      }, 50);
    });
  }
});