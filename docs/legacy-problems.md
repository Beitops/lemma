# Legacy beta problems

Problem statements and input context exported before introducing multiple objectives per workspace. Solutions, strategies, branches, steps, assumptions, decisions, activity, and generated results are intentionally omitted.

## Divisibility among selected integers

Original workspace ID: `0e596b7b-b62f-432a-900a-1d543a14d6c9`

Let $n$ be a positive integer. Prove that whenever $n+1$ distinct integers are selected from $\{1,2,\ldots,2n\}$, there are two selected integers such that one divides the other.

## Classification of Pythagorean Triples

Original workspace ID: `7017ada9-b437-4a60-8863-683bf6191ee5`

Classify all positive Pythagorean triples. Prove that every primitive triple can be written, after swapping $x$ and $y$ if necessary, as

$$
x=m^2-n^2,\qquad y=2mn,\qquad z=m^2+n^2,
$$

where $m>n>0$, $\gcd(m,n)=1$, and $m,n$ have opposite parity. Also prove the converse and derive all non-primitive triples by introducing a common factor.

### Input context: Basic

A Pythagorean triple is a triple of positive integers $(x,y,z)$ satisfying

$$
x^2+y^2=z^2.
$$

It is primitive when $\gcd(x,y,z)=1$.

## Unit Fractions and Divisors of a Square

Original workspace ID: `1545d68c-3ba3-478b-bcb1-4f993d15af08`

For a fixed positive integer $n$, determine all ordered pairs of positive integers $(x,y)$ satisfying

$$
\frac{1}{x}+\frac{1}{y}=\frac{1}{n}.
$$

Prove that the resulting parametrization contains every solution, calculate the number of ordered and unordered solutions in terms of the divisors of $n^2$, and illustrate the result for $n=12$.

### Input context: Basic

We work exclusively with positive integers. The solutions $(x,y)$ and $(y,x)$ are considered different when counting ordered pairs, but equivalent when counting unordered pairs. Let $\tau(m)$ denote the number of positive divisors of $m$. The solution must prove both that every proposed pair satisfies the equation and that no solutions are omitted. For $n=12$, derive the solutions from the general theory rather than using brute force as the main argument. Also identify when a symmetric solution with $x=y$ occurs.
