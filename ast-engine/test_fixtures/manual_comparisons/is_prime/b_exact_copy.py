def is_prime(n):
    limit = n
    if n < 2:
        return False
    for i in range(2, limit):
        if n % i == 0:
            return False
    return True
