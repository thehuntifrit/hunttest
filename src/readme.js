
document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('toggle-readme-btn');
    const container = document.getElementById('readme-container');
    let isLoaded = false;

    if (!toggleBtn || !container) return;

    toggleBtn.addEventListener('click', async () => {
        const isHidden = container.classList.contains('hidden');

        if (isHidden) {
            // Show
            container.classList.remove('hidden');
            toggleBtn.innerHTML = '<span>📖</span> ユーザーマニュアルを閉じる';
            
            if (!isLoaded) {
                try {
                    container.innerHTML = '<p class="text-center text-gray-400 animate-pulse">読み込み中...</p>';
                    const response = await fetch('./README.md');
                    if (!response.ok) throw new Error('Failed to load README');
                    
                    const text = await response.text();
                    // Configure marked if needed, or use defaults
                    container.innerHTML = marked.parse(text);
                    isLoaded = true;
                } catch (error) {
                    console.error(error);
                    container.innerHTML = '<p class="text-red-400 text-center">マニュアルの読み込みに失敗しました。</p>';
                }
            }
        } else {
            // Hide
            container.classList.add('hidden');
            toggleBtn.innerHTML = '<span>📖</span> ユーザーマニュアルを表示';
            // Scroll back to button if needed, or just leave it
            toggleBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });
});
