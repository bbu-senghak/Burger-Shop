document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const categorySelect = document.getElementById('category-select');
    const usernameInput = document.getElementById('txt-username');
    const passwordInput = document.getElementById('txt-password');
    const invalidCredentialsMsg = document.getElementById('msg-invalid-credentials');
    const loginButton = document.getElementById('btn-login');
    const API_BASE_URL = 'http://localhost:3000';

    // Submit form when pressing "Enter" key
    const submitOnEnter = (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            loginButton.click();
        }
    };

    usernameInput.addEventListener('keypress', submitOnEnter);
    passwordInput.addEventListener('keypress', submitOnEnter);

    // Show Password functionality (Requires a checkbox with id="show-password" in HTML)
    const showPasswordCheckbox = document.getElementById('show-password');
    if (showPasswordCheckbox) {
        showPasswordCheckbox.addEventListener('change', (event) => {
            passwordInput.type = event.target.checked ? 'text' : 'password';
        });
    }

    loginButton.addEventListener('click', async (event) => {
        event.preventDefault();

        const selectedCategory = categorySelect.value;
        const username = usernameInput.value.trim();
        const password = passwordInput.value;

        if (selectedCategory === 'Select Your Role' || selectedCategory === 'Select category') {
            invalidCredentialsMsg.textContent = 'Please select your role.';
            invalidCredentialsMsg.style.display = 'block';
            return;
        }

        if (username === '') {
            invalidCredentialsMsg.textContent = 'Please enter your username.';
            invalidCredentialsMsg.style.display = 'block';
            return;
        }

        if (password === '') {
            invalidCredentialsMsg.textContent = 'Please enter your password.';
            invalidCredentialsMsg.style.display = 'block';
            return;
        }

        try {
            const response = await fetch(`${API_BASE_URL}/api/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    category: selectedCategory,
                    username: username,
                    password: password
                })
            });

            const data = await response.json();

            if (data.success) {
                invalidCredentialsMsg.style.display = 'none';
                localStorage.setItem('authToken', data.token);
                localStorage.setItem('authRole', data.role);
                localStorage.setItem('authenticatedUser', data.role); // backward compatibility
                window.location.href = `${data.role}.html`;
            } else {
                invalidCredentialsMsg.textContent = data.message;
                invalidCredentialsMsg.style.display = 'block';
            }
        } catch (error) {
            console.error('Error:', error);
            invalidCredentialsMsg.textContent = 'An error occurred during login.';
            invalidCredentialsMsg.style.display = 'block';
        }
    });
});
