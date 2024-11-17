document.getElementById('fileInput').addEventListener('change', function(e) {
    const fileName = e.target.files[0]?.name || 'Ningún archivo seleccionado';
    document.getElementById('fileName').textContent = fileName;
});

document.getElementById('uploadForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const file = document.getElementById('fileInput').files[0];
    const messageDiv = document.getElementById('message');
    
    if (!file) {
        showMessage('Por favor selecciona un archivo', 'error');
        return;
    }

    try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (response.ok) {
            showMessage(data.message, 'success');
        } else {
            showMessage(data.error, 'error');
        }
    } catch (error) {
        showMessage('Error al procesar el archivo: ' + error.message, 'error');
    }
});

function showMessage(text, type) {
    const messageDiv = document.getElementById('message');
    messageDiv.textContent = text;
    messageDiv.className = `message ${type}`;
} 