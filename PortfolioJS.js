function toggleMenu() {
    const nav = document.querySelector('.navigate');
    if (nav.style.display === 'flex') {
        nav.style.display = 'none';
    } else {
        nav.style.display = 'flex';
    }
}

//Autoclose
document.querySelectorAll('.navigate a').forEach(link => {
    link.addEventListener('click', () => {
      const nav = document.querySelector('.navigate');
      if (window.innerWidth <= 768) {
        nav.style.display = 'none';
      }
    });
  });

